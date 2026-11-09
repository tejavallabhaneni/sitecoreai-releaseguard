/** Parsers for the raw values Sitecore stores in fields. Pure, no I/O. */

const GUID_BODY = "[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}";
const GUID_RE = new RegExp(`\\{?(${GUID_BODY})\\}?`, "g");
const SINGLE_GUID_RE = new RegExp(`^\\{?${GUID_BODY}\\}?$`);

/** `{AAAAAAAA-BBBB-...}` upper-case braced form, or "" when the value is not a GUID. */
export function normalizeId(value: string | undefined | null): string {
  const raw = (value ?? "").trim().replace(/[{}]/g, "").replace(/-/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(raw)) return "";
  const hex = raw.toUpperCase();
  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}}`;
}

export function isGuid(value: string | undefined | null): boolean {
  return SINGLE_GUID_RE.test((value ?? "").trim());
}

export function isEmptyGuid(value: string): boolean {
  return normalizeId(value) === "{00000000-0000-0000-0000-000000000000}";
}

/** Every GUID in a value (pipe lists, XML, query strings). */
export function extractGuids(value: string): string[] {
  const out: string[] = [];
  for (const match of value.matchAll(GUID_RE)) {
    const id = normalizeId(match[1]);
    if (id && !isEmptyGuid(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;|&#160;/g, "\u00a0")
    .replace(/&amp;/g, "&");
}

/** Attributes of the first element with `tag` in an XML/HTML fragment. */
export function readAttributes(fragment: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  for (const match of fragment.matchAll(re)) {
    attrs[match[1].toLowerCase()] = decodeEntities(match[3] ?? match[4] ?? "");
  }
  return attrs;
}

export interface GeneralLink {
  linktype: string;
  url: string;
  id: string;
  anchor: string;
  text: string;
}

/** `<link linktype="internal" id="{...}" url="..." />`, or null when the field is empty / not a link. */
export function parseGeneralLink(value: string): GeneralLink | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /<link\b([^>]*)\/?>/i.exec(trimmed);
  if (!match) return null;
  const attrs = readAttributes(match[1]);
  return {
    linktype: (attrs.linktype || "").toLowerCase(),
    url: attrs.url || "",
    id: normalizeId(attrs.id),
    anchor: attrs.anchor || "",
    text: attrs.text || "",
  };
}

export interface ImageValue {
  mediaId: string;
  alt: string | null;
}

/** `<image mediaid="{...}" alt="..." />`, or null when nothing is selected. */
export function parseImage(value: string): ImageValue | null {
  const match = /<image\b([^>]*)\/?>/i.exec(value.trim());
  if (!match) return null;
  const attrs = readAttributes(match[1]);
  const mediaId = normalizeId(attrs.mediaid);
  if (!mediaId) return null;
  return { mediaId, alt: "alt" in attrs ? attrs.alt : null };
}

export interface RichTextLink {
  href: string;
  /** Item ID for `~/link.aspx?_id=` links. */
  itemId?: string;
  /** Media ID for `-/media/<id>.ashx` links. */
  mediaId?: string;
  external?: string;
}

export interface RichTextImage {
  src: string;
  alt: string | null;
  mediaId?: string;
}

const LINK_ASPX_RE = /~\/link\.aspx\?[^"'\s]*_id=([0-9a-fA-F-{}]{32,38})/i;
const MEDIA_RE = /(?:~|-)\/media\/([0-9a-fA-F]{32})\.ashx/i;

/** Links and images inside a Rich Text value. */
export function parseRichText(html: string): { links: RichTextLink[]; images: RichTextImage[] } {
  const links: RichTextLink[] = [];
  const images: RichTextImage[] = [];
  for (const match of html.matchAll(/<a\b([^>]*)>/gi)) {
    const attrs = readAttributes(match[1]);
    if (!("href" in attrs)) continue;
    const href = attrs.href.trim();
    const link: RichTextLink = { href };
    const internal = LINK_ASPX_RE.exec(href);
    const media = MEDIA_RE.exec(href);
    if (internal) link.itemId = normalizeId(internal[1]);
    else if (media) link.mediaId = normalizeId(media[1]);
    else if (/^https?:\/\//i.test(href)) link.external = href;
    links.push(link);
  }
  for (const match of html.matchAll(/<img\b([^>]*)>/gi)) {
    const attrs = readAttributes(match[1]);
    const src = attrs.src ?? "";
    const media = MEDIA_RE.exec(src);
    images.push({
      src,
      alt: "alt" in attrs ? attrs.alt : null,
      ...(media ? { mediaId: normalizeId(media[1]) } : {}),
    });
  }
  return { links, images };
}

export interface RenderingRef {
  /** Rendering definition item ID (`s:id` / `id`). */
  renderingId: string;
  /** Datasource as stored: a GUID, an absolute path, `local:/...`, or a query. */
  datasource: string;
  placeholder: string;
  uid: string;
}

/** Every rendering in a `__Renderings` / `__Final Renderings` value. */
export function parseRenderings(xml: string): RenderingRef[] {
  const out: RenderingRef[] = [];
  if (!xml.trim()) return out;
  for (const match of xml.matchAll(/<r\b([^>]*?)\/?>/gi)) {
    const attrs = readAttributes(match[1]);
    const renderingId = normalizeId(attrs["s:id"] || attrs.id);
    const datasource = (attrs["s:ds"] ?? attrs.ds ?? "").trim();
    // The layout root (`<r xmlns:...>`) carries no rendering.
    if (!renderingId && !datasource) continue;
    out.push({
      renderingId,
      datasource,
      placeholder: attrs["s:ph"] ?? attrs.ph ?? "",
      uid: normalizeId(attrs.uid),
    });
  }
  return out;
}

/** True when a page has any presentation at all. */
export function hasLayout(std: { renderings?: string; finalRenderings?: string }): boolean {
  return Boolean((std.renderings ?? "").trim() || (std.finalRenderings ?? "").trim());
}

/**
 * Resolve a datasource to something a lookup can answer: a GUID or an absolute
 * path. `local:` is relative to the page. Queries cannot be checked statically.
 */
export function resolveDatasource(datasource: string, itemPath: string): string | null {
  const ds = datasource.trim();
  if (!ds) return null;
  if (isGuid(ds)) return normalizeId(ds);
  if (ds.toLowerCase().startsWith("local:")) {
    const rest = ds.slice("local:".length).replace(/^\/+/, "");
    return `${itemPath.replace(/\/+$/, "")}/${rest}`;
  }
  if (ds.startsWith("/sitecore/")) return ds;
  return null;
}

/** Sitecore ISO-ish dates: `20261109T143000Z`, `20261109T143000`, or a real ISO string. */
export function parseSitecoreDate(value: string | undefined): Date | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const compact = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?::\d+)?(Z)?$/.exec(raw);
  if (compact) {
    const [, y, mo, d, h, mi, s] = compact;
    const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
    return Number.isNaN(date.getTime()) || +y < 1900 ? null : date;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isChecked(value: string | undefined): boolean {
  return (value ?? "").trim() === "1";
}

/** Owner of a `__Lock` value, or "" when the item is not locked. */
export function lockOwner(value: string | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const attrs = readAttributes(raw);
  return attrs.owner ?? "";
}

/** Strip markup and whitespace to decide whether a value is "empty". */
export function isBlank(value: string | undefined | null): boolean {
  const raw = value ?? "";
  if (!raw.trim()) return true;
  if (!/[<&]/.test(raw)) return false;
  const text = decodeEntities(raw.replace(/<(img|image|link|iframe|video)\b/gi, "X<").replace(/<[^>]*>/g, ""))
    .replace(/ /g, " ")
    .trim();
  return text.length === 0;
}

/** Field types whose value is item references. */
export const REFERENCE_TYPES = new Set(
  [
    "droplink",
    "droptree",
    "grouped droplink",
    "multilist",
    "multilist with search",
    "treelist",
    "treelistex",
    "treelist with search",
    "checklist",
    "multiroot treelist",
    "tag treelist",
    "taglist",
  ].map((t) => t.toLowerCase()),
);

export function fieldKind(type: string): "link" | "image" | "richtext" | "reference" | "text" | "other" {
  const t = type.trim().toLowerCase();
  if (t === "general link" || t === "general link with search" || t === "link") return "link";
  if (t === "image") return "image";
  if (t === "rich text") return "richtext";
  if (REFERENCE_TYPES.has(t)) return "reference";
  if (t === "single-line text" || t === "multi-line text" || t === "text" || t === "memo") return "text";
  return "other";
}

/** Guess a field's kind from its value when the template did not say. */
export function sniffKind(value: string): "link" | "image" | "richtext" | "reference" | "text" {
  const v = value.trim();
  if (/^<link\b/i.test(v)) return "link";
  if (/^<image\b/i.test(v)) return "image";
  if (/^\{?[0-9a-fA-F-]{32,36}\}?(\|\{?[0-9a-fA-F-]{32,36}\}?)*$/.test(v)) return "reference";
  if (/<(p|a|img|div|span|h[1-6]|ul|ol|li|br|strong|em)\b/i.test(v)) return "richtext";
  return "text";
}
