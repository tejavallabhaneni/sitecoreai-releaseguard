/**
 * Item icons for the content tree, as the Content Transfer app learned to load them.
 *
 * - The Authoring API's `icon` is usually a relative or themed path (`Office/16x16/document.png`,
 *   `/-/icon/…`). Icons are served by each environment's CM host, which the app learns once from
 *   the preview API: it answers the same field with an absolute URL.
 * - `/-/icon/…` only answers a browser signed in to that CM, so the CM's static icon cache
 *   (`/temp/iconcache/{path}`) is tried first, then other CMs' caches (a themed icon is the same
 *   bitmap everywhere), then `/-/icon/…` itself.
 * - A media item's icon is its own thumbnail, wrapped as `/-/icon/-/media/{id}.ashx?thn=1`; the
 *   bare `/-/media/…` form needs no sign-in.
 * - Tree icons are 16×16, the size the cache holds.
 */

/** The icon value as text: the API returns a string, or `{ url }` / `{ value }` on some schemas. */
export function iconText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    for (const candidate of [rec.url, rec.value]) if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

export function absoluteOrigin(url: string): string {
  try {
    return /^https?:\/\//i.test(url) ? new URL(url).origin : "";
  } catch {
    return "";
  }
}

const atTreeSize = (path: string) => path.replace(/\/\d+x\d+\//, "/16x16/");

function treeIconUrl(url: string): string {
  const media = url.replace(/\/[-~]\/icon\/[-~]\/media\//i, "/-/media/");
  return media !== url ? media : url.replace(/(\/[-~]\/icon\/[^?#]*?)\/\d+x\d+\//i, "$1/16x16/");
}

function resolveIcon(raw: string, origin: string): string | undefined {
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw)) return treeIconUrl(raw);
  if (/^\/[-~]\/(icon|media)\//i.test(raw)) return origin ? treeIconUrl(origin + raw) : undefined;
  return origin ? `${origin}/-/icon/${atTreeSize(raw.replace(/^~?\/?/, ""))}` : undefined;
}

function themedIcon(url: string): { origin: string; path: string } | undefined {
  const match = url.match(/^(https?:\/\/[^/?#]+)(?:\/sitecore\/shell)?\/[-~]\/icon\/([^?#]+?)(?:\.aspx)?(?:[?#].*)?$/i);
  if (!match || /^[-~]\/media\//i.test(match[2])) return undefined;
  return { origin: match[1], path: atTreeSize(match[2]) };
}

/**
 * Every URL worth trying for an item's icon, best first. `knownOrigins` are other CM hosts seen
 * this session, whose icon caches hold the same themed bitmaps.
 */
export function iconSources(raw: string, origin: string, knownOrigins: Iterable<string> = []): string[] {
  const primary = resolveIcon(raw, origin);
  if (!primary) return [];
  const themed = themedIcon(primary);
  if (!themed) return [primary];
  const origins = [themed.origin, ...[...knownOrigins].filter((other) => other !== themed.origin)];
  return [...new Set([...origins.map((host) => `${host}/temp/iconcache/${themed.path.toLowerCase()}`), primary])];
}

/** A media item that is not a folder: its thumbnail is a better icon than the generic one. */
export function isMediaFile(path: string, hasChildren: boolean): boolean {
  return /^\/sitecore\/media library\//i.test(path) && !hasChildren;
}
