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

/** Elements that never have a closing tag. */
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
/** Elements HTML lets you leave unclosed: a browser closes them for you, so they are not errors. */
const OPTIONAL_CLOSE = new Set(["p", "li", "dt", "dd", "tr", "td", "th", "thead", "tbody", "tfoot", "option", "optgroup", "colgroup", "caption", "rb", "rt", "rp"]);
/** Document wrappers sometimes pasted into rich text; they are not part of the structure check. */
const WRAPPER_TAGS = new Set(["html", "head", "body"]);
/** Opening one of these closes an open `<p>`. */
const CLOSES_P = new Set([
  "address", "article", "aside", "blockquote", "details", "div", "dl", "fieldset", "figcaption", "figure", "footer",
  "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "main", "nav", "ol", "p", "pre", "section", "table", "ul",
]);
/** Opening the key closes any of these at the top of the stack. */
const IMPLIED_CLOSE: Record<string, string[]> = {
  li: ["li"],
  dt: ["dt", "dd"],
  dd: ["dt", "dd"],
  tr: ["td", "th", "tr"],
  td: ["td", "th"],
  th: ["td", "th"],
  option: ["option"],
  thead: ["td", "th", "tr", "tbody", "tfoot"],
  tbody: ["td", "th", "tr", "thead", "tfoot"],
  tfoot: ["td", "th", "tr", "thead", "tbody"],
};

/** Comments, CDATA and the raw text of script/style blocks: not markup to balance. */
function stripNonMarkup(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "<$1></$1>");
}

const TAG_RE = /<(\/?)([a-zA-Z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

/**
 * Structural problems in a Rich Text value: tags left open, closing tags with nothing to close, and
 * tags that were never finished. Lenient where HTML is: `<p>` and `<li>` may be left open.
 */
export function htmlStructureProblems(html: string): string[] {
  const problems: string[] = [];
  const add = (p: string) => {
    if (!problems.includes(p)) problems.push(p);
  };
  const src = stripNonMarkup(html);
  const stack: string[] = [];
  for (const match of src.matchAll(TAG_RE)) {
    const closing = match[1] === "/";
    const tag = match[2].toLowerCase();
    if (WRAPPER_TAGS.has(tag)) continue;
    if (closing) {
      if (VOID_TAGS.has(tag)) continue;
      const at = stack.lastIndexOf(tag);
      if (at < 0) {
        add(`</${tag}> has no opening tag`);
        continue;
      }
      for (const open of stack.slice(at + 1)) {
        if (!OPTIONAL_CLOSE.has(open)) add(`<${open}> is not closed before </${tag}>`);
      }
      stack.length = at;
      continue;
    }
    if (VOID_TAGS.has(tag) || /\/\s*$/.test(match[3])) continue;
    const implied = IMPLIED_CLOSE[tag];
    while (stack.length && implied?.includes(stack[stack.length - 1])) stack.pop();
    if (CLOSES_P.has(tag) && stack[stack.length - 1] === "p") stack.pop();
    stack.push(tag);
  }
  for (const open of stack) if (!OPTIONAL_CLOSE.has(open)) add(`<${open}> is never closed`);
  // A tag cut off before its ">": the next "<" or the end of the value comes first.
  const cut = /<\/?([a-zA-Z][\w:.-]*)\b[^<>]*(?=<|$)/.exec(src.replace(TAG_RE, ""));
  if (cut) add(`<${cut[1].toLowerCase()}> tag is not finished (no ">")`);
  return problems;
}

export interface UnsafeMarkup {
  /** Script that runs in the visitor's browser: `<script>`, `on…=` handlers, `javascript:` URLs, plug-ins. */
  dangerous: string[];
  /** Third-party content embedded in the page (`<iframe>`). Often intended, still worth a look. */
  embeds: string[];
}

/** Markup in a Rich Text value that can run code or pull in another site. */
export function unsafeMarkup(html: string): UnsafeMarkup {
  const dangerous: string[] = [];
  const embeds: string[] = [];
  const add = (list: string[], p: string) => {
    if (!list.includes(p)) list.push(p);
  };
  const src = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const match of src.matchAll(TAG_RE)) {
    if (match[1] === "/") continue;
    const tag = match[2].toLowerCase();
    if (tag === "script") add(dangerous, "<script>");
    else if (tag === "object" || tag === "embed" || tag === "applet") add(dangerous, `<${tag}>`);
    else if (tag === "base" || (tag === "meta" && /http-equiv/i.test(match[3]))) add(dangerous, `<${tag}>`);
    else if (tag === "iframe" || tag === "frame") add(embeds, `<${tag}>`);
    for (const handler of match[3].matchAll(/(?:^|\s)(on[a-z]+)\s*=/gi)) add(dangerous, `${handler[1].toLowerCase()}= handler`);
    const attrs = readAttributes(match[3]);
    for (const [name, value] of Object.entries(attrs)) {
      // <a href="javascript:…"> is already reported as a link with no destination.
      if (tag === "a" && name === "href") continue;
      if (/^\s*(javascript|vbscript):/i.test(value)) add(dangerous, `${value.trim().split(":")[0].toLowerCase()}: URL in ${name}`);
      else if (/^\s*data:text\/html/i.test(value)) add(dangerous, `data:text/html URL in ${name}`);
    }
  }
  return { dangerous, embeds };
}

/** Leftovers from pasting out of Word, Outlook or Google Docs. */
export function pastedJunk(html: string): string[] {
  const found: string[] = [];
  const checks: [RegExp, string][] = [
    [/mso-[a-z-]+\s*:/i, "Word mso- styles"],
    [/class\s*=\s*["']?Mso/i, "Word Mso classes"],
    [/<\/?(o|w|v|m|st1):[a-z]/i, "Office XML tags such as <o:p>"],
    [/<!--\s*\[if\b/i, "Office conditional comments"],
    [/docs-internal-guid/i, "Google Docs wrappers"],
    [/<font\b/i, "<font> tags"],
    [/style\s*=\s*["'][^"']*font-family\s*:/i, "inline font-family styles"],
    [/<span\b[^>]*>(?:\s|&nbsp;)*<\/span>/i, "empty <span> wrappers"],
  ];
  for (const [re, label] of checks) if (re.test(html)) found.push(label);
  return found;
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
    // Date.UTC rolls over (month 13, day 40, hour 25): such values are garbage, not dates.
    const exact =
      date.getUTCMonth() === +mo - 1 && date.getUTCDate() === +d && date.getUTCHours() === +h && date.getUTCMinutes() === +mi;
    return Number.isNaN(date.getTime()) || !exact || +y < 1900 ? null : date;
  }
  // Only ISO-shaped strings: V8 reads `new Date("12")` as a day in 2001.
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return null;
  const date = new Date(raw);
  // Year < 1900 is Sitecore's "no date" (DateTime.MinValue), as for the compact form.
  return Number.isNaN(date.getTime()) || date.getUTCFullYear() < 1900 ? null : date;
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
