/**
 * Turns what Sitecore sends back on a failed request into one short, readable sentence.
 *
 * The XMC client hands back the parsed response body, which can be a GraphQL envelope, a
 * problem-details object (`title`, `detail`, `errors: { field: [...] }`), a plain string, or a
 * whole HTML page (Cloudflare answers for an environment it cannot reach).
 */

const MAX_DETAIL = 300;

/** Gateway and Cloudflare origin failures: the environment itself is not answering. */
const UNREACHABLE_STATUSES = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 530]);

/** Cloudflare error codes that mean the environment's host is gone or not answering. */
const CLOUDFLARE_CODES: Record<string, string> = {
  "1001": "the environment's host name no longer resolves",
  "1016": "the environment's host name no longer resolves",
  "1033": "the environment's tunnel is down",
};

export interface FailureDetail {
  /** What the response said, cleaned up; "" when it said nothing useful. */
  detail: string;
  /** Cloudflare's error reference (e.g. "1016") when the body is a Cloudflare error page. */
  cloudflareCode?: string;
}

function clip(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > MAX_DETAIL ? `${clean.slice(0, MAX_DETAIL - 1).trimEnd()}…` : clean;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, "&");
}

function textOf(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function looksLikeHtml(text: string): boolean {
  return /^\s*(<!doctype html|<html|<head|<body)/i.test(text) || /<\/(html|body|div|p|h1)>/i.test(text);
}

function fromHtml(html: string): FailureDetail {
  const plain = textOf(html);
  const code = /Error reference number:?\s*(\d{3,4})/i.exec(plain)?.[1] ?? /\bError code:?\s*(\d{3,4})\b/i.exec(plain)?.[1];
  const heading = textOf(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? "");
  const title = textOf(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  // A Cloudflare page's <title> is often just the code; prefer the heading.
  const label = heading || (title && !/^\d+$/.test(title) ? title : "") || plain.slice(0, 120);
  const known = code ? CLOUDFLARE_CODES[code] : undefined;
  const parts = [label, code ? `Cloudflare error ${code}${known ? `: ${known}` : ""}` : ""].filter(Boolean);
  return { detail: clip(parts.join(" — ")), cloudflareCode: code };
}

const MESSAGE_KEYS = ["message", "title", "detail", "error_description", "error", "Message", "errorMessage", "reason"];

function fromValue(value: unknown, depth: number): string[] {
  if (value == null || depth > 4) return [];
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return [];
    return [looksLikeHtml(text) ? fromHtml(text).detail : text];
  }
  if (typeof value === "number" || typeof value === "boolean") return [];
  if (Array.isArray(value)) return value.flatMap((v) => fromValue(v, depth + 1));
  const rec = value as Record<string, unknown>;
  const out: string[] = [];
  for (const key of MESSAGE_KEYS) out.push(...fromValue(rec[key], depth + 1));
  const errors = rec.errors;
  if (Array.isArray(errors)) {
    out.push(...errors.flatMap((e) => fromValue(e, depth + 1)));
  } else if (errors && typeof errors === "object") {
    // Problem details: { errors: { "body.query": ["The query field is required."] } }
    for (const [field, messages] of Object.entries(errors as Record<string, unknown>)) {
      const text = fromValue(messages, depth + 1).join(" ");
      if (text) out.push(field && field !== "$" ? `${field}: ${text}` : text);
    }
  }
  return out;
}

/** The useful part of a failed response body. Never "Unknown error": unknown shapes are shown as JSON. */
export function failureDetail(body: unknown): FailureDetail {
  if (typeof body === "string" && looksLikeHtml(body)) return fromHtml(body);
  const found = [...new Set(fromValue(body, 0))];
  if (found.length) return { detail: clip(found.join("; ")) };
  if (body && typeof body === "object") {
    try {
      const json = JSON.stringify(body);
      if (json && json !== "{}" && json !== "[]") return { detail: clip(json) };
    } catch {
      // Circular: nothing more to say.
    }
  }
  return { detail: "" };
}

/** Sitecore's gateway could not swap the user's session for an environment token. */
function isTokenExchange(status: number | null, detail: string): boolean {
  return status === 422 && /token exchange/i.test(detail);
}

/**
 * Worth sending again: a failed token exchange, rate limiting, or a gateway hiccup. Not 530 or a
 * Cloudflare origin error (the environment is gone), and not other 4xx (the request itself is wrong).
 */
export function isTransientFailure(status: number | null, body: unknown): boolean {
  if (status === 429 || status === 502 || status === 503 || status === 504) return true;
  return isTokenExchange(status, failureDetail(body).detail);
}

export interface DescribedFailure {
  message: string;
  status: number | null;
  /** The environment itself is not answering (stopped, deleted, DNS gone). */
  unreachable: boolean;
}

/** One sentence for a failed call: what failed, the status, what Sitecore said, and what to do. */
export function describeFailure(what: string, status: number | null, body: unknown): DescribedFailure {
  const { detail, cloudflareCode } = failureDetail(body);
  const http = status === null ? "an HTTP error" : `HTTP ${status}`;
  const unreachable = (status !== null && UNREACHABLE_STATUSES.has(status)) || Boolean(cloudflareCode && CLOUDFLARE_CODES[cloudflareCode]);
  let message: string;
  if (unreachable) {
    message =
      `${what} failed with ${http}: this environment can't be reached${detail ? ` (${detail})` : ""}. ` +
      "It may be stopped, still being created, or deleted. Check it in Cloud Portal.";
  } else if (isTokenExchange(status, detail)) {
    message =
      `${what} failed with ${http}: ${detail}. Sitecore could not issue an access token for this environment, even after ` +
      "retrying. This is usually temporary: run the audit again. If it keeps happening, sign out of Cloud Portal and back " +
      "in, or reinstall the app on this environment.";
  } else if (status === 401 || status === 403) {
    message =
      `${what} failed with ${http}${detail ? `: ${detail}` : ""}. ` +
      "Check that Publish Guard is installed on this environment and has SitecoreAI APIs access in App studio.";
  } else if (status === 429) {
    message = `${what} failed with ${http}: Sitecore is limiting requests${detail ? ` (${detail})` : ""}. Wait a minute and try again.`;
  } else {
    message = `${what} failed with ${http}: ${detail || "Sitecore sent no details"}`;
  }
  return { message, status, unreachable };
}
