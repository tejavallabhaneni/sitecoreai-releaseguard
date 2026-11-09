/** Server-side external link checker used by `/api/link-check`. Node only (DNS + fetch). */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPrivateAddress } from "@/lib/link-safety";
import { LINK_CHECK_TIMEOUT_MS } from "@/lib/config";
import type { ExternalLinkResult } from "@/lib/types";

export const MAX_REDIRECTS = 5;
const USER_AGENT = "ReleaseGuard-LinkCheck/1.0 (+content audit)";

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

/** Check one URL: never throws, never calls a private address, follows up to MAX_REDIRECTS redirects. */
export async function checkLink(raw: string): Promise<ExternalLinkResult> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { url: raw, ok: false, status: null, verdict: "broken", reason: "Malformed URL" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LINK_CHECK_TIMEOUT_MS);
  try {
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
      let res = await request(url, "HEAD", controller.signal);
      // Plenty of servers refuse HEAD; ask again properly before calling it broken.
      if (res.status === 405 || res.status === 501 || res.status === 403 || res.status === 400) {
        res = await request(url, "GET", controller.signal);
      }
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
  } catch (error) {
    const aborted = controller.signal.aborted;
    return {
      url: raw,
      ok: false,
      status: null,
      verdict: "unverified",
      reason: aborted ? "Timed out" : `Connection failed (${(error as Error).message})`,
    };
  } finally {
    clearTimeout(timer);
  }
}
