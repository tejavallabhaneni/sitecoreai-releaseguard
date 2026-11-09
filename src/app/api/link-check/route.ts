import { checkLink } from "@/lib/link-check";
import { LINK_CHECK_MAX_URLS } from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const urls = (body as { urls?: unknown })?.urls;
  if (!Array.isArray(urls) || urls.some((u) => typeof u !== "string")) {
    return Response.json({ error: "Expected { urls: string[] }." }, { status: 400 });
  }
  if (urls.length > LINK_CHECK_MAX_URLS) {
    return Response.json({ error: `At most ${LINK_CHECK_MAX_URLS} URLs per request.` }, { status: 413 });
  }
  const unique = [...new Set(urls as string[])].map((u) => u.slice(0, 2048));
  const results = await Promise.all(unique.map((u) => checkLink(u)));
  return Response.json({ results }, { headers: { "cache-control": "no-store" } });
}
