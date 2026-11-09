import { describe, expect, it } from "vitest";
import type {
  AuditChecks,
  AuditItem,
  AuditOptions,
  Category,
  ExternalLinkResult,
  Issue,
  ReferenceInfo,
  RuleId,
  StandardFields,
  TemplateField,
} from "@/lib/types";
import { normalizeId } from "./parse";
import { CATEGORY_LABELS, RULES, collectReferences, compareIssues, evaluate, type RuleContext } from "./rules";

// ---------------------------------------------------------------------------
// Builders: everything by hand, so each test states exactly what the rule sees.
// ---------------------------------------------------------------------------

const gid = (n: number) => normalizeId(`${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`);
const bare = (id: string) => id.replace(/[{}-]/g, "");
const TEMPLATE = gid(100);
const NOW = new Date("2026-11-09T12:00:00Z");
const LAYOUT_ID = "{FE5D7FDF-89C0-4D99-9AA3-B5FBD009C9F3}";

const ALL_CHECKS: AuditChecks = { required: true, links: true, externalLinks: true, images: true, languages: true, publishing: true };

function field(name: string, type = "Single-Line Text", extra: Partial<TemplateField> = {}): TemplateField {
  return { id: gid(500), name, type, section: "Content", required: false, shared: false, unversioned: false, ...extra };
}

function item(overrides: Partial<AuditItem> = {}): AuditItem {
  return {
    id: gid(1),
    name: "Page",
    path: "/sitecore/content/site/Home/Page",
    templateId: TEMPLATE,
    templateName: "Page",
    language: "en",
    hasVersion: true,
    version: 1,
    fields: {},
    std: {},
    workflow: null,
    ...overrides,
  };
}

const layout = (...rs: { id?: string; ds?: string; ph?: string }[]) =>
  `<r xmlns:p="p" xmlns:s="s"><d id="${LAYOUT_ID}">${rs
    .map((r, i) => `<r uid="${gid(900 + i)}"${r.id ? ` s:id="${r.id}"` : ""} s:ph="${r.ph ?? "main"}"${r.ds !== undefined ? ` s:ds="${r.ds}"` : ""} />`)
    .join("")}</d></r>`;

/** A page std: has a layout with one existing rendering. */
const PAGE_STD: StandardFields = { renderings: layout({ id: gid(200) }) };

const exists = (fields: Record<string, string> = {}, extra: Partial<ReferenceInfo> = {}): ReferenceInfo => ({ exists: true, fields, ...extra });
const gone: ReferenceInfo = { exists: false, fields: {} };

interface Setup {
  items: (AuditItem | { id?: string; language: string; value: null })[];
  fields?: TemplateField[];
  refs?: Record<string, ReferenceInfo>;
  external?: ExternalLinkResult[];
  options?: Partial<AuditOptions>;
  checks?: Partial<AuditChecks>;
}

function context(setup: Setup): RuleContext {
  const items = new Map<string, Map<string, AuditItem | null>>();
  for (const entry of setup.items) {
    const id = entry.id ?? gid(1);
    if (!items.has(id)) items.set(id, new Map());
    items.get(id)!.set(entry.language, "value" in entry ? entry.value : entry);
  }
  return {
    options: {
      root: "/sitecore/content/site",
      depth: "subtree",
      maxItems: 100,
      primaryLanguage: "en",
      languages: [],
      pageRequiredFields: [],
      ...setup.options,
      checks: { ...ALL_CHECKS, ...setup.options?.checks, ...setup.checks },
    },
    items,
    templateFields: new Map([[TEMPLATE, setup.fields ?? []]]),
    references: new Map(Object.entries(setup.refs ?? {})),
    external: new Map((setup.external ?? []).map((r) => [r.url, r])),
    now: NOW,
  };
}

const run = (setup: Setup) => evaluate(context(setup));
const only = (issues: Issue[], rule: RuleId) => issues.filter((i) => i.rule === rule);
const rules = (issues: Issue[]) => issues.map((i) => i.rule);

function expectOne(issues: Issue[], rule: RuleId, match: Partial<Issue> = {}) {
  const hits = only(issues, rule);
  expect(hits, `${rule} in ${JSON.stringify(rules(issues))}`).toHaveLength(1);
  expect(hits[0]).toMatchObject({ rule, category: RULES[rule].category, ...match });
  return hits[0];
}

const glink = (attrs: Record<string, string>) => `<link ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(" ")} />`;

// ---------------------------------------------------------------------------

describe("rule catalogue", () => {
  it("gives every rule a category with a label and a title", () => {
    for (const [id, rule] of Object.entries(RULES)) {
      expect(CATEGORY_LABELS[rule.category], id).toBeTruthy();
      expect(rule.title, id).toBeTruthy();
    }
  });
});

describe("required-empty", () => {
  const fields = [field("Title", "Single-Line Text", { required: true })];

  it.each([
    ["empty", ""],
    ["whitespace", "   \n"],
    ["markup only", "<p>&nbsp;</p>"],
    ["empty paragraphs", "<p></p><p> </p>"],
  ])("fires as an error on a %s value", (_label, value) => {
    expectOne(run({ fields, items: [item({ fields: { Title: value } })] }), "required-empty", {
      severity: "error",
      field: "Title",
      language: "en",
    });
  });

  it("fires when the field is absent from the item", () => {
    expectOne(run({ fields, items: [item({ fields: {} })] }), "required-empty");
  });

  it("does not fire when filled (text, or markup with an image)", () => {
    expect(only(run({ fields, items: [item({ fields: { Title: "Hello" } })] }), "required-empty")).toEqual([]);
    expect(only(run({ fields, items: [item({ fields: { Title: '<p><img src="a.png"></p>' } })] }), "required-empty")).toEqual([]);
  });

  it("does not fire for a field that is not required", () => {
    expect(run({ fields: [field("Title")], items: [item({ fields: { Title: "" } })] })).toEqual([]);
  });

  it("does not fire for a language that has no version", () => {
    const issues = run({
      fields,
      options: { languages: ["fr"] },
      checks: { languages: false },
      items: [item({ fields: { Title: "Hi" } }), item({ language: "fr", hasVersion: false, fields: { Title: "" } })],
    });
    expect(only(issues, "required-empty")).toEqual([]);
  });

  it("still checks a language whose version status is unknown (hasVersion null)", () => {
    expectOne(run({ fields, items: [item({ hasVersion: null, fields: { Title: "" } })] }), "required-empty");
  });

  it("reports each language separately", () => {
    const issues = run({
      fields,
      options: { languages: ["fr"] },
      items: [item({ fields: { Title: "" } }), item({ language: "fr", fields: { Title: "" } })],
    });
    expect(only(issues, "required-empty").map((i) => i.language).sort()).toEqual(["en", "fr"]);
  });
});

describe("required-configured (page fields from the audit settings)", () => {
  const fields = [field("Title", "Single-Line Text", { required: true }), field("MetaDescription", "Multi-Line Text")];

  it("fires as a warning on a page with the field empty", () => {
    expectOne(
      run({ fields, options: { pageRequiredFields: ["MetaDescription"] }, items: [item({ std: PAGE_STD, fields: { Title: "x", MetaDescription: "" } })] }),
      "required-configured",
      { severity: "warning", field: "MetaDescription" },
    );
  });

  it("treats __Final Renderings alone as a layout", () => {
    const std = { finalRenderings: layout({ id: gid(200) }) };
    expectOne(
      run({ fields, options: { pageRequiredFields: ["MetaDescription"] }, items: [item({ std, fields: { Title: "x", MetaDescription: "" } })] }),
      "required-configured",
    );
  });

  it("does not fire on items without a layout", () => {
    const issues = run({ fields, options: { pageRequiredFields: ["MetaDescription"] }, items: [item({ fields: { Title: "x", MetaDescription: "" } })] });
    expect(only(issues, "required-configured")).toEqual([]);
  });

  it("does not fire for a field neither the item nor its template has", () => {
    const issues = run({ fields, options: { pageRequiredFields: ["OgImage"] }, items: [item({ std: PAGE_STD, fields: { Title: "x" } })] });
    expect(only(issues, "required-configured")).toEqual([]);
  });

  it("fires for a template field the item read did not return", () => {
    expectOne(
      run({ fields, options: { pageRequiredFields: ["MetaDescription"] }, items: [item({ std: PAGE_STD, fields: { Title: "x" } })] }),
      "required-configured",
    );
  });

  it("matches field names case-insensitively and reports the real name", () => {
    expectOne(
      run({ fields, options: { pageRequiredFields: ["  metadescription "] }, items: [item({ std: PAGE_STD, fields: { Title: "x", MetaDescription: " " } })] }),
      "required-configured",
      { field: "MetaDescription" },
    );
  });

  it("does not duplicate a field already flagged by required-empty", () => {
    const issues = run({ fields, options: { pageRequiredFields: ["title"] }, items: [item({ std: PAGE_STD, fields: { Title: "", MetaDescription: "m" } })] });
    expectOne(issues, "required-empty");
    expect(only(issues, "required-configured")).toEqual([]);
  });

  it("does not fire when filled, or for blank config entries", () => {
    const issues = run({ fields, options: { pageRequiredFields: ["MetaDescription", "", "  "] }, items: [item({ std: PAGE_STD, fields: { Title: "x", MetaDescription: "m" } })] });
    expect(only(issues, "required-configured")).toEqual([]);
  });
});

describe("validation-regex", () => {
  const meta = (extra: Partial<TemplateField> = {}) => [field("Meta", "Multi-Line Text", { validation: "^.{0,5}$", ...extra })];

  it("fires as a warning with the template's message and the value as target", () => {
    expectOne(run({ fields: meta({ validationText: "Too long." }), items: [item({ fields: { Meta: "123456" } })] }), "validation-regex", {
      severity: "warning",
      message: "Too long.",
      target: "123456",
    });
  });

  it("falls back to a message naming the pattern", () => {
    const issue = expectOne(run({ fields: meta(), items: [item({ fields: { Meta: "123456" } })] }), "validation-regex");
    expect(issue.message).toContain("^.{0,5}$");
  });

  it("truncates the target to 120 characters", () => {
    const issue = expectOne(run({ fields: meta(), items: [item({ fields: { Meta: "x".repeat(500) } })] }), "validation-regex");
    expect(issue.target).toHaveLength(120);
  });

  it("does not fire when the value matches, or is blank", () => {
    expect(run({ fields: meta(), items: [item({ fields: { Meta: "12345" } })] })).toEqual([]);
    expect(run({ fields: meta(), items: [item({ fields: { Meta: "" } })] })).toEqual([]);
  });

  it("ignores a pattern JavaScript cannot compile instead of crashing", () => {
    expect(() => run({ fields: meta({ validation: "([" }), items: [item({ fields: { Meta: "anything" } })] })).not.toThrow();
    expect(run({ fields: meta({ validation: "(?i)^a$" }), items: [item({ fields: { Meta: "b" } })] })).toEqual([]);
  });
});

describe("General Link fields", () => {
  const fields = [field("Cta", "General Link")];
  const withLink = (value: string, setup: Partial<Setup> = {}) => run({ fields, items: [item({ fields: { Cta: value } })], ...setup });

  it("link-internal-broken: internal link to a missing item is an error", () => {
    expectOne(withLink(glink({ linktype: "internal", id: gid(7) }), { refs: { [gid(7)]: gone } }), "link-internal-broken", {
      severity: "error",
      field: "Cta",
      target: gid(7),
    });
  });

  it("internal link to an existing item, or one never looked up, is fine", () => {
    expect(withLink(glink({ linktype: "internal", id: gid(7) }), { refs: { [gid(7)]: exists() } })).toEqual([]);
    expect(withLink(glink({ linktype: "internal", id: gid(7) }))).toEqual([]);
  });

  it("link-empty: internal link with no target item", () => {
    expectOne(withLink(glink({ linktype: "internal", text: "Go" })), "link-empty", { severity: "warning", field: "Cta" });
  });

  it("link-media-broken: media link to a missing item", () => {
    expectOne(withLink(glink({ linktype: "media", id: gid(8) }), { refs: { [gid(8)]: gone } }), "link-media-broken", { severity: "error", target: gid(8) });
    expect(withLink(glink({ linktype: "media", id: gid(8) }), { refs: { [gid(8)]: exists() } })).toEqual([]);
  });

  it("link-empty: media link with no media item", () => {
    expectOne(withLink(glink({ linktype: "media" })), "link-empty");
  });

  it("link-empty: external link with no URL", () => {
    expectOne(withLink(glink({ linktype: "external", url: "  " })), "link-empty");
  });

  it("link-empty: mailto without an address, but not with one", () => {
    expectOne(withLink(glink({ linktype: "mailto", url: "mailto:" })), "link-empty", { target: "mailto:" });
    expect(withLink(glink({ linktype: "mailto", url: "mailto:team@example.com" }))).toEqual([]);
  });

  it("ignores link values without a linktype, and other link types", () => {
    expect(withLink(glink({ text: "x" }))).toEqual([]);
    expect(withLink(glink({ linktype: "anchor", anchor: "top" }))).toEqual([]);
  });

  describe("external links", () => {
    const url = "https://example.com/page";
    const ext = (verdict: ExternalLinkResult["verdict"], extra: Partial<ExternalLinkResult> = {}): ExternalLinkResult => ({
      url,
      ok: verdict === "ok",
      status: verdict === "ok" ? 200 : 404,
      verdict,
      ...extra,
    });
    const value = glink({ linktype: "external", url });

    it("link-external-broken is an error naming the status", () => {
      const issue = expectOne(withLink(value, { external: [ext("broken")] }), "link-external-broken", { severity: "error", target: url });
      expect(issue.message).toContain("404");
    });

    it("link-external-broken falls back to the reason without a status", () => {
      const issue = expectOne(withLink(value, { external: [ext("broken", { status: null, reason: "DNS lookup failed" })] }), "link-external-broken");
      expect(issue.message).toContain("DNS lookup failed");
    });

    it("link-external-unverified is info", () => {
      expectOne(withLink(value, { external: [ext("unverified", { status: 403, reason: "HTTP 403" })] }), "link-external-unverified", { severity: "info" });
    });

    it("ok, or not checked at all, raises nothing", () => {
      expect(withLink(value, { external: [ext("ok")] })).toEqual([]);
      expect(withLink(value)).toEqual([]);
    });

    it("externalLinks off ignores even a broken result", () => {
      expect(withLink(value, { external: [ext("broken")], checks: { externalLinks: false } })).toEqual([]);
    });

    it("link-insecure flags http:// as info, even with externalLinks off", () => {
      const http = "http://example.com/x";
      expectOne(withLink(glink({ linktype: "external", url: http }), { checks: { externalLinks: false } }), "link-insecure", {
        severity: "info",
        target: http,
      });
      expect(only(withLink(value), "link-insecure")).toEqual([]);
    });
  });

  it("links off: no link rules at all", () => {
    expect(withLink(glink({ linktype: "internal", id: gid(7) }), { refs: { [gid(7)]: gone }, checks: { links: false } })).toEqual([]);
    expect(withLink(glink({ linktype: "external", url: "http://x.y" }), { checks: { links: false } })).toEqual([]);
  });

  it("sniffs a link when the template does not know the field", () => {
    expectOne(run({ items: [item({ fields: { Unknown: glink({ linktype: "internal", id: gid(7) }) } })], refs: { [gid(7)]: gone } }), "link-internal-broken");
  });

  it("does not sniff a field the template types as text", () => {
    const issues = run({ fields: [field("Note", "Single-Line Text")], items: [item({ fields: { Note: glink({ linktype: "internal", id: gid(7) }) } })], refs: { [gid(7)]: gone } });
    expect(issues).toEqual([]);
  });
});

describe("Rich Text links", () => {
  const fields = [field("Body", "Rich Text")];
  const body = (html: string, setup: Partial<Setup> = {}) => run({ fields, items: [item({ fields: { Body: html } })], ...setup });

  it("~/link.aspx to a missing item is link-internal-broken", () => {
    expectOne(body(`<a href="~/link.aspx?_id=${bare(gid(7))}&amp;_z=z">x</a>`, { refs: { [gid(7)]: gone } }), "link-internal-broken", {
      field: "Body",
      target: gid(7),
    });
    expect(body(`<a href="~/link.aspx?_id=${bare(gid(7))}">x</a>`, { refs: { [gid(7)]: exists() } })).toEqual([]);
  });

  it("-/media/ link to a missing media item is link-media-broken", () => {
    expectOne(body(`<a href="-/media/${bare(gid(8))}.ashx">pdf</a>`, { refs: { [gid(8)]: gone } }), "link-media-broken", { target: gid(8) });
  });

  it.each([
    ['href="#"', "#"],
    ['href="javascript:void(0)"', "javascript:void(0)"],
    ['href=""', "(empty href)"],
  ])("%s is link-empty", (attr, target) => {
    expectOne(body(`<p><a ${attr}>x</a></p>`), "link-empty", { severity: "warning", target });
  });

  it("relative links, anchors with names, and <a> without href are fine", () => {
    expect(body('<a href="/about">a</a><a href="#section">b</a><a name="top"></a>')).toEqual([]);
  });

  it("external links go through the external and insecure checks", () => {
    const issues = body('<a href="http://old.example.com/x">x</a>', {
      external: [{ url: "http://old.example.com/x", ok: false, status: 500, verdict: "broken" }],
    });
    expectOne(issues, "link-external-broken");
    expectOne(issues, "link-insecure");
  });

  it("deduplicates the same broken link repeated in one field", () => {
    const a = `<a href="~/link.aspx?_id=${bare(gid(7))}">x</a>`;
    expectOne(body(a + a + a, { refs: { [gid(7)]: gone } }), "link-internal-broken");
  });
});

describe("reference-broken", () => {
  it("fires on a Droplink to a missing item", () => {
    expectOne(run({ fields: [field("Category", "Droplink")], items: [item({ fields: { Category: gid(7) } })], refs: { [gid(7)]: gone } }), "reference-broken", {
      severity: "error",
      category: "links",
      target: gid(7),
    });
  });

  it("fires once per missing ID in a Multilist pipe list", () => {
    const issues = run({
      fields: [field("Related", "Multilist")],
      items: [item({ fields: { Related: `${gid(6)}|${gid(7)}|${gid(8)}` } })],
      refs: { [gid(6)]: exists(), [gid(7)]: gone, [gid(8)]: gone },
    });
    expect(only(issues, "reference-broken").map((i) => i.target)).toEqual([gid(7), gid(8)]);
  });

  it("does not fire when every reference exists", () => {
    expect(run({ fields: [field("Related", "Treelist")], items: [item({ fields: { Related: `${gid(6)}|${gid(7)}` } })], refs: { [gid(6)]: exists(), [gid(7)]: exists() } })).toEqual([]);
  });

  it("sniffs a GUID list when the template type is unknown", () => {
    expectOne(run({ items: [item({ fields: { Mystery: `${gid(6)}|${gid(7)}` } })], refs: { [gid(6)]: exists(), [gid(7)]: gone } }), "reference-broken");
  });

  it("does not treat a GUID in a text field as a reference", () => {
    expect(run({ fields: [field("Code", "Single-Line Text")], items: [item({ fields: { Code: gid(7) } })], refs: { [gid(7)]: gone } })).toEqual([]);
  });

  it("is off with links off", () => {
    expect(run({ fields: [field("Category", "Droplink")], items: [item({ fields: { Category: gid(7) } })], refs: { [gid(7)]: gone }, checks: { links: false } })).toEqual([]);
  });
});

describe("Image fields", () => {
  const fields = [field("Hero", "Image")];
  const img = (alt?: string) => `<image mediaid="${gid(9)}"${alt === undefined ? "" : ` alt="${alt}"`} />`;
  const withImage = (value: string, media: ReferenceInfo | undefined, setup: Partial<Setup> = {}) =>
    run({ fields, items: [item({ fields: { Hero: value } })], refs: media ? { [gid(9)]: media } : {}, ...setup });

  it("image-alt-missing: no alt on the field and none on the media item", () => {
    expectOne(withImage(img(), exists({ Alt: "" }, { path: "/sitecore/media library/hero" })), "image-alt-missing", {
      severity: "error",
      category: "images",
      field: "Hero",
      target: "/sitecore/media library/hero",
    });
    expectOne(withImage(img(" "), exists({ Alt: "" })), "image-alt-missing", { target: gid(9) });
  });

  it("alt on the field or on the media item is enough", () => {
    expect(withImage(img("A tent"), exists({ Alt: "" }))).toEqual([]);
    expect(withImage(img(""), exists({ Alt: "A tent" }))).toEqual([]);
  });

  it("does not guess when the media item could not be looked up", () => {
    expect(withImage(img(), undefined)).toEqual([]);
  });

  it("image-media-broken: the media item is gone (and no alt issue on top)", () => {
    const issues = withImage(img(), gone);
    expectOne(issues, "image-media-broken", { severity: "error", target: gid(9) });
    expect(only(issues, "image-alt-missing")).toEqual([]);
  });

  it("an empty image field is not checked", () => {
    expect(withImage("<image />", undefined)).toEqual([]);
    expect(withImage("", undefined)).toEqual([]);
  });

  it("is off with images off", () => {
    expect(withImage(img(), gone, { checks: { images: false } })).toEqual([]);
  });
});

describe("Rich Text images", () => {
  const fields = [field("Body", "Rich Text")];
  const body = (html: string, setup: Partial<Setup> = {}) => run({ fields, items: [item({ fields: { Body: html } })], ...setup });

  it("richtext-image-alt-missing: an <img> with no alt attribute", () => {
    expectOne(body('<p><img src="/a.png"></p>'), "richtext-image-alt-missing", { severity: "error", target: "/a.png" });
  });

  it('alt="" (decorative) or real alt text is fine', () => {
    expect(body('<img src="/a.png" alt="">')).toEqual([]);
    expect(body('<img src="/a.png" alt="A tent">')).toEqual([]);
  });

  it("an embedded media item that is gone is image-media-broken instead", () => {
    const issues = body(`<img src="-/media/${bare(gid(9))}.ashx">`, { refs: { [gid(9)]: gone } });
    expectOne(issues, "image-media-broken", { target: gid(9) });
    expect(only(issues, "richtext-image-alt-missing")).toEqual([]);
  });

  it("images off: no image rules; links still checked", () => {
    const issues = body('<img src="/a.png"><a href="#">x</a>', { checks: { images: false } });
    expect(rules(issues)).toEqual(["link-empty"]);
  });

  it("links off: no link rules; images still checked", () => {
    const issues = body('<img src="/a.png"><a href="#">x</a>', { checks: { links: false } });
    expect(rules(issues)).toEqual(["richtext-image-alt-missing"]);
  });
});

describe("language rules", () => {
  const fields = [field("Title"), field("Body", "Rich Text"), field("Sku", "Single-Line Text", { shared: true }), field("Price", "Number", { unversioned: true })];
  const en = (extra: Partial<AuditItem> = {}) => item({ fields: { Title: "Hello", Body: "<p>Hi</p>", Sku: "A1", Price: "9" }, ...extra });
  const fr = (extra: Partial<AuditItem> = {}) => item({ language: "fr", fields: { Title: "Bonjour", Body: "<p>Salut</p>", Sku: "A1", Price: "9" }, ...extra });
  const opts = { languages: ["fr"] };

  it("language-missing-version: an error for pages", () => {
    expectOne(run({ fields, options: opts, items: [en({ std: PAGE_STD }), fr({ hasVersion: false })] }), "language-missing-version", {
      severity: "error",
      language: "fr",
    });
  });

  it("language-missing-version: a warning for non-pages", () => {
    expectOne(run({ fields, options: opts, items: [en(), fr({ hasVersion: false })] }), "language-missing-version", { severity: "warning", language: "fr" });
  });

  it("language-missing-version: a null read counts as missing", () => {
    expectOne(run({ fields, options: opts, items: [en(), { language: "fr", value: null }] }), "language-missing-version");
  });

  it("no issue when the language was not read, or has a version", () => {
    expect(run({ fields, options: opts, items: [en()] })).toEqual([]);
    expect(run({ fields, options: opts, items: [en(), fr()] })).toEqual([]);
  });

  it("the primary language listed again in languages is not checked against itself", () => {
    expect(run({ fields, options: { languages: ["en"] }, items: [en()] })).toEqual([]);
  });

  it("language-untranslated-fields: versioned fields filled in primary but empty in the other language", () => {
    const issue = expectOne(
      run({ fields, options: opts, items: [en(), fr({ fields: { Title: "", Body: "<p>&nbsp;</p>", Sku: "", Price: "" } })] }),
      "language-untranslated-fields",
      { severity: "warning", language: "fr", target: "Title, Body" },
    );
    expect(issue.message).toContain("2 fields are");
  });

  it("shared and unversioned fields are not expected to be translated", () => {
    expect(run({ fields, options: opts, items: [en(), fr({ fields: { Title: "Bonjour", Body: "<p>x</p>" } })] })).toEqual([]);
  });

  it("fields empty in the primary language are not expected either", () => {
    expect(run({ fields, options: opts, items: [en({ fields: { Title: "Hello", Body: "" } }), fr({ fields: { Title: "Bonjour", Body: "" } })] })).toEqual([]);
  });

  it("lists at most six fields in the message", () => {
    const names = Array.from({ length: 8 }, (_, i) => `F${i}`);
    const issue = expectOne(
      run({
        options: opts,
        items: [item({ fields: Object.fromEntries(names.map((n) => [n, "x"])) }), item({ language: "fr", fields: {} })],
      }),
      "language-untranslated-fields",
    );
    expect(issue.message).toContain("F5…");
    expect(issue.message).not.toContain("F6");
    expect(issue.target).toBe(names.join(", "));
  });

  it("language-no-primary-version: a warning, and nothing else about languages", () => {
    const issues = run({ fields, options: opts, items: [en({ hasVersion: false }), fr({ hasVersion: false })] });
    expectOne(issues, "language-no-primary-version", { severity: "warning", language: "en" });
    expect(only(issues, "language-missing-version")).toEqual([]);
  });

  it("language-no-primary-version: a null primary read with another language present", () => {
    const issues = run({ fields, options: opts, items: [{ language: "en", value: null }, fr()] });
    expectOne(issues, "language-no-primary-version", { language: "en", itemId: gid(1) });
  });

  it("is off with languages off", () => {
    expect(run({ fields, options: opts, checks: { languages: false }, items: [en({ std: PAGE_STD }), fr({ hasVersion: false })] })).toEqual([]);
  });
});

describe("workflow", () => {
  it("publish-workflow-not-final from the item's workflow", () => {
    expectOne(run({ items: [item({ workflow: { state: "Draft", final: false } })] }), "publish-workflow-not-final", {
      severity: "error",
      category: "publishing",
      target: "Draft",
    });
  });

  it("a final workflow state is fine", () => {
    expect(run({ items: [item({ workflow: { state: "Approved", final: true } })] })).toEqual([]);
  });

  it("publish-workflow-not-final via the __Workflow state lookup (Final field)", () => {
    const state = gid(40);
    expectOne(
      run({ items: [item({ std: { workflowState: bare(state).toLowerCase() } })], refs: { [state]: exists({ Final: "" }, { name: "Awaiting Approval" }) } }),
      "publish-workflow-not-final",
      { target: "Awaiting Approval" },
    );
  });

  it("a looked-up state with Final=1, a missing state, or no lookup is fine", () => {
    const state = gid(40);
    expect(run({ items: [item({ std: { workflowState: state } })], refs: { [state]: exists({ Final: "1" }) } })).toEqual([]);
    expect(run({ items: [item({ std: { workflowState: state } })], refs: { [state]: gone } })).toEqual([]);
    expect(run({ items: [item({ std: { workflowState: state } })] })).toEqual([]);
  });

  it("the item's own workflow wins over the state field", () => {
    const state = gid(40);
    expect(run({ items: [item({ workflow: { state: "Done", final: true }, std: { workflowState: state } })], refs: { [state]: exists({ Final: "" }) } })).toEqual([]);
  });
});

describe("publishing restrictions", () => {
  const two = (std: StandardFields, frStd: StandardFields = std) => ({
    options: { languages: ["fr"] },
    checks: { languages: false },
    items: [item({ std }), item({ language: "fr", std: frStd })],
  });

  it("publish-never-publish: a warning, reported once on the primary language", () => {
    const issues = run(two({ neverPublish: "1" }));
    expectOne(issues, "publish-never-publish", { severity: "warning", language: "en" });
  });

  it("never publish unticked is fine", () => {
    expect(run({ items: [item({ std: { neverPublish: "0" } })] })).toEqual([]);
    expect(run({ items: [item({ std: { neverPublish: "" } })] })).toEqual([]);
  });

  it("publish-hidden-version: a warning per hidden version", () => {
    const issues = run(two({ hideVersion: "1" }, {}));
    expectOne(issues, "publish-hidden-version", { severity: "warning", language: "en" });
  });

  it("publish-scheduled: a future publish date is info, reported once (shared field)", () => {
    const issue = expectOne(run(two({ publish: "20991231T000000Z" })), "publish-scheduled", { severity: "info", language: "en" });
    expect(issue.target).toBe("2099-12-31T00:00:00.000Z");
  });

  it("publish-scheduled: a future valid-from is per version", () => {
    const issues = run(two({}, { validFrom: "20991231T000000" }));
    expectOne(issues, "publish-scheduled", { language: "fr" });
  });

  it("past or garbage start dates are fine", () => {
    expect(run({ items: [item({ std: { publish: "20200101T000000Z", validFrom: "2020-01-01T00:00:00Z" } })] })).toEqual([]);
    expect(run({ items: [item({ std: { publish: "12", validFrom: "00010101T000000" } })] })).toEqual([]);
  });

  it("publish-expired: a past unpublish date is a warning, reported once (shared field)", () => {
    expectOne(run(two({ unpublish: "20250301T000000Z" })), "publish-expired", { severity: "warning", language: "en" });
  });

  it("publish-expired: a past valid-to is per version, and 'now' counts as past", () => {
    const issues = run(two({}, { validTo: NOW.toISOString() }));
    expectOne(issues, "publish-expired", { language: "fr" });
  });

  it("future end dates are fine", () => {
    expect(run({ items: [item({ std: { unpublish: "20991231T000000Z", validTo: "20991231T000000Z" } })] })).toEqual([]);
  });

  it("publish-locked: a warning naming the owner", () => {
    expectOne(run({ items: [item({ std: { lock: '<r owner="sitecore\\bob" date="20261108T101500Z" />' } })] }), "publish-locked", {
      severity: "warning",
      target: "sitecore\\bob",
    });
  });

  it("an unlocked item (<r />, or nothing) is fine", () => {
    expect(run({ items: [item({ std: { lock: "<r />" } })] })).toEqual([]);
    expect(run({ items: [item({ std: { lock: "" } })] })).toEqual([]);
  });

  it("publishing off: none of these", () => {
    const issues = run({
      checks: { publishing: false },
      items: [item({ workflow: { state: "Draft", final: false }, std: { neverPublish: "1", hideVersion: "1", lock: '<r owner="x" />', publish: "20991231T000000Z" } })],
    });
    expect(issues).toEqual([]);
  });

  it("not checked on a language without a version", () => {
    const issues = run({
      options: { languages: ["fr"] },
      checks: { languages: false },
      items: [item(), item({ language: "fr", hasVersion: false, std: { hideVersion: "1", lock: '<r owner="x" />' } })],
    });
    expect(issues).toEqual([]);
  });
});

describe("renderings", () => {
  const page = (std: StandardFields, refs: Record<string, ReferenceInfo>, extra: Partial<Setup> = {}) =>
    run({ items: [item({ std })], refs: { [gid(200)]: exists(), ...refs }, ...extra });

  it("rendering-datasource-broken: a GUID datasource that is gone", () => {
    expectOne(page({ renderings: layout({ id: gid(200), ds: gid(20) }) }, { [gid(20)]: gone }), "rendering-datasource-broken", {
      severity: "error",
      category: "publishing",
      target: gid(20),
      field: "placeholder main",
    });
  });

  it("rendering-datasource-broken: an absolute path datasource that is gone", () => {
    const ds = "/sitecore/content/site/Data/Gone";
    expectOne(page({ renderings: layout({ id: gid(200), ds }) }, { [ds]: gone }), "rendering-datasource-broken", { target: ds });
  });

  it("rendering-datasource-broken: a local:/ datasource resolved against the page path", () => {
    const resolved = "/sitecore/content/site/Home/Page/Data/Hero";
    expectOne(page({ renderings: layout({ id: gid(200), ds: "local:/Data/Hero" }) }, { [resolved]: gone }), "rendering-datasource-broken", {
      target: "local:/Data/Hero",
    });
    expect(page({ renderings: layout({ id: gid(200), ds: "local:/Data/Hero" }) }, { [resolved]: exists() })).toEqual([]);
  });

  it("existing datasources, and query: datasources, are fine", () => {
    expect(page({ renderings: layout({ id: gid(200), ds: gid(20) }) }, { [gid(20)]: exists() })).toEqual([]);
    expect(page({ renderings: layout({ id: gid(200), ds: "query:./*[@@templatename='Hero']" }) }, {})).toEqual([]);
  });

  it("rendering-definition-missing: a rendering item that is gone, reported once", () => {
    const issues = page({ renderings: layout({ id: gid(201), ph: "a" }, { id: gid(201), ph: "b" }) }, { [gid(201)]: gone });
    expectOne(issues, "rendering-definition-missing", { severity: "error", target: gid(201), field: "placeholder a" });
  });

  it("checks __Final Renderings on every language but shared __Renderings only on the primary", () => {
    const issues = run({
      options: { languages: ["fr"] },
      checks: { languages: false },
      items: [
        item({ std: { renderings: layout({ id: gid(200), ds: gid(21) }) } }),
        item({ language: "fr", std: { renderings: layout({ id: gid(200), ds: gid(21) }), finalRenderings: layout({ id: gid(200), ds: gid(22) }) } }),
      ],
      refs: { [gid(200)]: exists(), [gid(21)]: gone, [gid(22)]: gone },
    });
    const ds = only(issues, "rendering-datasource-broken").map((i) => `${i.language}:${i.target}`);
    expect(ds.sort()).toEqual([`en:${gid(21)}`, `fr:${gid(22)}`]);
  });

  it("the same missing datasource in both layouts is one issue", () => {
    const xml = layout({ id: gid(200), ds: gid(21) });
    expectOne(page({ renderings: xml, finalRenderings: xml }, { [gid(21)]: gone }), "rendering-datasource-broken");
  });
});

describe("evaluate: dedupe and ordering", () => {
  it("never reports the same rule/item/language/field/target twice", () => {
    const issues = run({
      fields: [field("Related", "Multilist")],
      items: [item({ fields: { Related: `${gid(7)}|${gid(7)}|{${bare(gid(7)).toLowerCase()}}` } })],
      refs: { [gid(7)]: gone },
    });
    expect(only(issues, "reference-broken")).toHaveLength(1);
    expect(new Set(issues.map((i) => i.key)).size).toBe(issues.length);
  });

  it("sorts errors first, then warnings, then info; then by path, language, rule", () => {
    const issues = run({
      fields: [field("Title", "Single-Line Text", { required: true }), field("Cta", "General Link")],
      items: [
        item({ id: gid(2), path: "/b", fields: { Title: "x", Cta: glink({ linktype: "external", url: "http://x.y" }) }, std: { lock: '<r owner="x" />' } }),
        item({ id: gid(3), path: "/a", fields: { Title: "" }, std: { hideVersion: "1" } }),
        item({ id: gid(4), path: "/c", fields: { Title: "" } }),
      ],
    });
    expect(issues.map((i) => `${i.severity}:${i.itemPath}:${i.rule}`)).toEqual([
      "error:/a:required-empty",
      "error:/c:required-empty",
      "warning:/a:publish-hidden-version",
      "warning:/b:publish-locked",
      "info:/b:link-insecure",
    ]);
    expect([...issues].sort(compareIssues)).toEqual(issues);
  });

  it("skips items with nothing read", () => {
    expect(run({ items: [{ language: "en", value: null }] })).toEqual([]);
  });

  it("uses the primary language's template and layout for every language", () => {
    const issues = run({
      fields: [field("Title", "Single-Line Text", { required: true })],
      options: { languages: ["fr"] },
      items: [item({ fields: { Title: "x" } }), item({ language: "fr", templateId: gid(999), fields: { Title: "" } })],
    });
    expectOne(issues, "required-empty", { language: "fr" });
  });
});

describe("checks toggles", () => {
  // One item that trips at least one rule in every category.
  const fields = [field("Title", "Single-Line Text", { required: true }), field("Cta", "General Link"), field("Hero", "Image")];
  const setup = (checks: Partial<AuditChecks>): Setup => ({
    fields,
    checks,
    options: { languages: ["fr"] },
    items: [
      item({
        std: { ...PAGE_STD, neverPublish: "1" },
        fields: { Title: "", Cta: glink({ linktype: "internal", id: gid(7) }), Hero: `<image mediaid="${gid(9)}" />` },
      }),
      item({ language: "fr", hasVersion: false }),
    ],
    refs: { [gid(200)]: exists(), [gid(7)]: gone, [gid(9)]: exists({ Alt: "" }) },
  });
  const categories = (issues: Issue[]) => new Set(issues.map((i) => i.category));
  const ALL: Category[] = ["required", "links", "images", "languages", "publishing"];

  it("with everything on, every category reports", () => {
    expect(categories(run(setup({})))).toEqual(new Set(ALL));
  });

  it.each(ALL)("%s off reports nothing in that category, and keeps the others", (category) => {
    const found = categories(run(setup({ [category]: false })));
    expect(found.has(category)).toBe(false);
    expect(found).toEqual(new Set(ALL.filter((c) => c !== category)));
  });
});

describe("collectReferences", () => {
  const fields = [
    field("Cta", "General Link"),
    field("Ext", "General Link"),
    field("Hero", "Image"),
    field("Body", "Rich Text"),
    field("Related", "Multilist"),
    field("Note", "Single-Line Text"),
  ];
  const subject = item({
    fields: {
      Cta: glink({ linktype: "internal", id: gid(1) }),
      Ext: glink({ linktype: "external", url: "https://e.com/a" }),
      Hero: `<image mediaid="${gid(2)}" />`,
      Body: `<a href="~/link.aspx?_id=${bare(gid(3))}">a</a><a href="-/media/${bare(gid(4))}.ashx">b</a><a href="https://e.com/b">c</a>`,
      Related: `${gid(5)}|${gid(6)}`,
      Note: gid(99),
      Empty: "",
    },
    std: {
      renderings: layout({ id: gid(10), ds: gid(11) }, { id: gid(10), ds: "local:/Data" }, { id: gid(10), ds: "query:./*" }),
      finalRenderings: layout({ id: gid(12), ds: "/sitecore/content/x" }),
      workflowState: gid(13),
    },
  });

  it("collects every ID, path, and external URL the rules will ask about", () => {
    const { refs, external } = collectReferences(subject, fields, true);
    expect([...refs].sort()).toEqual(
      [gid(1), gid(2), gid(3), gid(4), gid(5), gid(6), gid(10), gid(11), gid(12), gid(13), "/sitecore/content/site/Home/Page/Data", "/sitecore/content/x"].sort(),
    );
    expect([...external].sort()).toEqual(["https://e.com/a", "https://e.com/b"]);
  });

  it("skips the workflow state when not needed or when the item reports its workflow", () => {
    expect(collectReferences(subject, fields, false).refs.has(gid(13))).toBe(false);
    expect(collectReferences({ ...subject, workflow: { state: "x", final: true } }, fields, true).refs.has(gid(13))).toBe(false);
  });

  it("does not send non-http external links to the checker", () => {
    const { external } = collectReferences(item({ fields: { Cta: glink({ linktype: "external", url: "ftp://x" }) } }), fields, false);
    expect(external.size).toBe(0);
  });
});
