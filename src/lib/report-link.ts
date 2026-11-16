/**
 * A report file carried in a link's fragment, so it can be downloaded outside Sitecore's frame.
 *
 * Sitecore loads the app in a sandboxed iframe without `allow-downloads` or `allow-popups`, so the
 * frame cannot save a file or open a tab. The Marketplace SDK can ask the host page (which is not
 * sandboxed) to open a URL in a new tab. The report travels gzip-compressed in that URL's fragment
 * (`/export#r=…`): a fragment is never sent to any server, and the export page removes it from the
 * address bar as soon as it has read it.
 */

export const EXPORT_PATH = "/export";
/** Stay well under browsers' URL limits (Chrome: 2 MB). A bigger report falls back to copying. */
export const MAX_LINK_LENGTH = 1_500_000;

export interface ReportFile {
  name: string;
  type: string;
  text: string;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64 + "===".slice((b64.length + 3) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const piped = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

/** The fragment value for a report: gzip-compressed JSON, base64url. */
export async function encodeReport(file: ReportFile): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify({ v: 1, ...file }));
  return toBase64Url(await pipe(json, new CompressionStream("gzip")));
}

/** The report in a fragment value, or an error saying the link is incomplete. */
export async function decodeReport(token: string): Promise<ReportFile> {
  let parsed: unknown;
  try {
    const bytes = await pipe(fromBase64Url(token), new DecompressionStream("gzip"));
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("This link does not hold a complete report. Export it again from Publish Guard.");
  }
  const rec = parsed as Partial<ReportFile> & { v?: number };
  if (rec?.v !== 1 || typeof rec.name !== "string" || typeof rec.type !== "string" || typeof rec.text !== "string") {
    throw new Error("This link does not hold a complete report. Export it again from Publish Guard.");
  }
  // The name becomes a download name: keep it a plain file name.
  const name = rec.name.replace(/[^\w.\-]+/g, "-").slice(0, 120) || "publish-guard-report.txt";
  return { name, type: rec.type, text: rec.text };
}

/** The full export URL for a report, under `origin`. */
export async function reportLink(origin: string, file: ReportFile): Promise<string> {
  return `${origin}${EXPORT_PATH}#r=${await encodeReport(file)}`;
}

/** The token in an export page's fragment (`#r=…`), or "". */
export function tokenFromHash(hash: string): string {
  const match = /^#?r=([A-Za-z0-9_-]+)$/.exec(hash.trim());
  return match ? match[1] : "";
}
