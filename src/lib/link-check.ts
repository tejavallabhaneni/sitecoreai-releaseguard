/** Server-side external link checker used by `/api/link-check`. Node only (DNS + fetch). */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPrivateAddress } from "@/lib/link-safety";
import { LINK_CHECK_TIMEOUT_MS } from "@/lib/config";
import type { ExternalLinkResult } from "@/lib/types";

export const MAX_REDIRECTS = 5;
const USER_AGENT = "PublishGuard-LinkCheck/1.0 (+content audit)";

async function assertPublic(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol");
  if (url.username || url.password) throw new Error("credentials in URL");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) throw new Error("private host");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) throw new Error("private address");
}

async function request(url: URL, method: "HEAD" | "GET", signal: AbortSignal): Promise<Response> {
  return fetch(url, {
    method,
    redirect: "manual",
    signal,
    headers: { "user-agent": USER_AGENT, accept: "text/html,*/*;q=0.8" },
  });
}

/** Follow one URL with one method, up to MAX_REDIRECTS redirects. Throws only on network errors. */
async function follow(raw: string, start: URL, method: "HEAD" | "GET", signal: AbortSignal): Promise<ExternalLinkResult> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    try {
      await assertPublic(url);
    } catch (error) {
      const reason = (error as Error).message;
      if (/ENOTFOUND|EAI_AGAIN|ENODATA/.test((error as NodeJS.ErrnoException).code ?? reason)) {
        return { url: raw, ok: false, status: null, verdict: "broken", reason: "DNS lookup failed" };
      }
      return { url: raw, ok: false, status: null, verdict: "unverified", reason: `Not checked: ${reason}` };
    }
    const res = await request(url, method, signal);
    res.body?.cancel().catch(() => {});
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return { url: raw, ok: false, status: res.status, verdict: "broken", reason: "Redirect without Location" };
      url = new URL(location, url);
      continue;
    }
    if (res.status < 400) return { url: raw, ok: true, status: res.status, verdict: "ok" };
    if (res.status === 401 || res.status === 403 || res.status === 429 || res.status === 999) {
      return { url: raw, ok: false, status: res.status, verdict: "unverified", reason: `HTTP ${res.status}` };
    }
    return { url: raw, ok: false, status: res.status, verdict: "broken", reason: `HTTP ${res.status}` };
  }
  return { url: raw, ok: false, status: null, verdict: "broken", reason: "Too many redirects" };
}

/** One pass with its own time limit; network errors and timeouts come back as unverified. */
async function attempt(raw: string, start: URL, method: "HEAD" | "GET"): Promise<ExternalLinkResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LINK_CHECK_TIMEOUT_MS);
  try {
    return await follow(raw, start, method, controller.signal);
  } catch (error) {
    return {
      url: raw,
      ok: false,
      status: null,
      verdict: "unverified",
      reason: controller.signal.aborted ? "Timed out" : `Connection failed (${(error as Error).message})`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check one URL: never throws, never calls a private address, follows up to MAX_REDIRECTS redirects.
 *
 * HEAD is only a cheap first try. Many servers answer it differently from the GET a browser sends:
 * Epic MyChart, for one, redirects a HEAD to its own error page, which then answers HEAD with 500
 * while the page itself loads fine. So any HTTP answer that is not a success is checked again from
 * the start with GET, and GET decides. No answer at all (blocked, DNS, timeout, connection) is not
 * retried: GET would fare no better and the check would only take twice as long.
 */
export async function checkLink(raw: string): Promise<ExternalLinkResult> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { url: raw, ok: false, status: null, verdict: "broken", reason: "Malformed URL" };
  }
  const head = await attempt(raw, url, "HEAD");
  if (head.ok) return head;
  const answered = head.status !== null || head.reason === "Too many redirects";
  return answered ? attempt(raw, url, "GET") : head;
}
