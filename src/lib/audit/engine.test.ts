import { describe, expect, it } from "vitest";
import { MAX_EXTERNAL_URLS } from "@/lib/config";
import { DEMO_IDS, DemoSource, demoExternalChecker } from "@/lib/sitecore/demo-source";
import type { AuditSource } from "@/lib/sitecore/source";
import type { AuditItem, AuditOptions, AuditProgress, ItemRef, ReferenceInfo, RuleId, TemplateDef, TemplateField } from "@/lib/types";
import { AuditCancelledError, resolveTemplateFields, runAudit, type ExternalChecker } from "./engine";
import { normalizeId } from "./parse";
import { issuesToCsv, summarize } from "./summary";

const options: AuditOptions = {
  root: "/sitecore/content/Northwind/Northwind Outdoor",
  depth: "subtree",
  maxItems: 500,
  primaryLanguage: "en",
  languages: ["fr-CA"],
  checks: { required: true, links: true, externalLinks: true, images: true, languages: true, publishing: true },
  pageRequiredFields: ["Title", "MetaDescription"],
};

async function audit(overrides: Partial<AuditOptions> = {}) {
  return runAudit({
    source: new DemoSource(0),
    environmentName: "Demo",
    options: { ...options, ...overrides },
    checkExternal: demoExternalChecker,
    now: new Date("2026-11-09T00:00:00Z"),
  });
}

function rulesFor(result: Awaited<ReturnType<typeof audit>>, itemId: string): RuleId[] {
  return result.issues.filter((i) => i.itemId === itemId).map((i) => i.rule);
}

describe("runAudit on the demo environment", () => {
  it("crawls the whole subtree", async () => {
    const result = await audit();
    expect(result.itemsScanned).toBe(14);
    expect(result.truncated).toBe(false);
  });

  it("finds required content gaps, including in other languages", async () => {
    const result = await audit();
    expect(rulesFor(result, DEMO_IDS.contact)).toContain("required-empty");
    const banner = result.issues.filter((i) => i.itemId === DEMO_IDS.banner && i.rule === "required-empty");
    expect(banner.map((i) => i.language)).toEqual(["en"]);
    expect(rulesFor(result, DEMO_IDS.guide)).toContain("validation-regex");
  });

  it("finds broken links, references, and empty links", async () => {
    const result = await audit();
    const tent = rulesFor(result, DEMO_IDS.tent);
    expect(tent).toContain("link-internal-broken");
    expect(tent).toContain("link-external-broken");
    expect(tent).toContain("link-insecure");
    expect(rulesFor(result, DEMO_IDS.banner)).toContain("reference-broken");
    expect(rulesFor(result, DEMO_IDS.contact)).toContain("link-empty");
    expect(rulesFor(result, DEMO_IDS.guide)).toContain("link-empty");
  });

  it("finds missing image descriptions", async () => {
    const result = await audit();
    expect(rulesFor(result, DEMO_IDS.jacket)).toContain("image-alt-missing");
    expect(rulesFor(result, DEMO_IDS.banner)).toContain("image-alt-missing");
    expect(rulesFor(result, DEMO_IDS.guide)).toContain("richtext-image-alt-missing");
    // Field alt is empty but the media item has Alt: fine.
    expect(rulesFor(result, DEMO_IDS.tent)).not.toContain("image-alt-missing");
  });

  it("finds incomplete languages", async () => {
    const result = await audit();
    const boots = result.issues.find((i) => i.itemId === DEMO_IDS.boots && i.rule === "language-missing-version");
    expect(boots).toMatchObject({ language: "fr-CA", severity: "error" });
    expect(rulesFor(result, DEMO_IDS.about)).toContain("language-untranslated-fields");
  });

  it("finds publishing problems", async () => {
    const result = await audit();
    expect(rulesFor(result, DEMO_IDS.jacket)).toContain("publish-workflow-not-final");
    expect(rulesFor(result, DEMO_IDS.guide)).toContain("publish-scheduled");
    expect(rulesFor(result, DEMO_IDS.promo)).toEqual(expect.arrayContaining(["publish-expired", "publish-never-publish"]));
    expect(rulesFor(result, DEMO_IDS.contact)).toContain("publish-locked");
    expect(rulesFor(result, DEMO_IDS.home)).toEqual(
      expect.arrayContaining(["rendering-datasource-broken", "rendering-definition-missing"]),
    );
  });

  it("respects disabled checks and depth", async () => {
    const result = await audit({
      depth: "item",
      root: DEMO_IDS.contact,
      checks: { required: false, links: false, externalLinks: false, images: false, languages: false, publishing: true },
    });
    expect(result.itemsScanned).toBe(1);
    expect(new Set(result.issues.map((i) => i.category))).toEqual(new Set(["publishing"]));
  });

  it("stops at the item limit", async () => {
    const result = await audit({ maxItems: 5 });
    expect(result.itemsScanned).toBe(5);
    expect(result.truncated).toBe(true);
  });

  it("summarizes and exports", async () => {
    const result = await audit();
    const summary = summarize(result);
    expect(summary.verdict).toBe("blocked");
    expect(summary.readiness).toBeGreaterThan(0);
    expect(summary.readiness).toBeLessThan(100);
    const csv = issuesToCsv(result.issues);
    expect(csv.split("\r\n")).toHaveLength(result.issues.length + 1);
  });

  it("can be cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runAudit({ source: new DemoSource(0), environmentName: "Demo", options, signal: controller.signal }),
    ).rejects.toThrow(/cancelled/);
  });
});

// ---------------------------------------------------------------------------
// Engine behaviour against a scripted in-memory source.
// ---------------------------------------------------------------------------


const gid = (n: number) => normalizeId(`${String(n).padStart(8, "0")}-0000-4000-8000-00000000abcd`);
const T_PAGE = gid(900);
const T_BASE = gid(901);

interface Node {
  id: string;
  name: string;
  parent: string | null;
  fields?: Record<string, string>;
  templateId?: string;
}

function tf(name: string, extra: Partial<TemplateField> = {}): TemplateField {
  return { id: gid(800), name, type: "Single-Line Text", section: "Data", required: false, shared: false, unversioned: false, ...extra };
}

class ScriptedSource implements AuditSource {
  readonly kind = "demo" as const;
  calls = { children: [] as string[], readItems: [] as string[][], readTemplate: [] as string[], lookup: [] as string[][] };
  /** Extra parent → children links, to model an item listed under two parents. */
  extraChildren = new Map<string, string[]>();
  failReadItems?: (language: string) => boolean;
  failTemplate?: (id: string) => boolean;
  failLookup = false;
  onReadItems?: () => void;

  constructor(
    public nodes: Node[],
    public templates: TemplateDef[] = [],
    public refs: Record<string, ReferenceInfo> = {},
  ) {}

  private ref(n: Node): ItemRef {
    const kids = this.nodes.some((c) => c.parent === n.id) || this.extraChildren.has(n.id);
    return { id: n.id, name: n.name, path: this.path(n), hasChildren: kids, templateId: n.templateId ?? T_PAGE };
  }
  private path(n: Node): string {
    const parent = this.nodes.find((p) => p.id === n.parent);
    return parent ? `${this.path(parent)}/${n.name}` : `/sitecore/content/${n.name}`;
  }
  async listSites() {
    return [];
  }
  async listLanguages() {
    return ["en"];
  }
  async resolve(pathOrId: string) {
    const n = this.nodes.find((x) => x.id === normalizeId(pathOrId) || this.path(x) === pathOrId);
    return n ? this.ref(n) : null;
  }
  async children(id: string, _language: string, limit = Infinity) {
    this.calls.children.push(id);
    const kids = [
      ...this.nodes.filter((n) => n.parent === id),
      ...(this.extraChildren.get(id) ?? []).map((k) => this.nodes.find((n) => n.id === k)!),
    ];
    return kids.slice(0, limit).map((n) => this.ref(n));
  }
  async readItems(ids: string[], language: string) {
    this.calls.readItems.push(ids);
    this.onReadItems?.();
    if (this.failReadItems?.(language)) throw new Error(`boom ${language}`);
    const out = new Map<string, AuditItem | null>();
    for (const id of ids) {
      const n = this.nodes.find((x) => x.id === id);
      out.set(
        id,
        n
          ? {
              id,
              name: n.name,
              path: this.path(n),
              templateId: n.templateId ?? T_PAGE,
              templateName: "Page",
              language,
              hasVersion: true,
              version: 1,
              fields: { ...(n.fields ?? {}) },
              std: {},
              workflow: null,
            }
          : null,
      );
    }
    return out;
  }
  async readTemplate(id: string) {
    this.calls.readTemplate.push(id);
    if (this.failTemplate?.(id)) throw new Error("template boom");
    return this.templates.find((t) => t.id === id) ?? null;
  }
  async lookup(refs: string[]) {
    this.calls.lookup.push(refs);
    if (this.failLookup) throw new Error("lookup boom");
    return new Map(refs.map((r) => [r, this.refs[r] ?? { exists: false, fields: {} }]));
  }
}

/** root → a, b; a → a1, a2; b → b1. */
function tree(): Node[] {
  return [
    { id: gid(1), name: "root", parent: null },
    { id: gid(2), name: "a", parent: gid(1) },
    { id: gid(3), name: "b", parent: gid(1) },
    { id: gid(4), name: "a1", parent: gid(2) },
    { id: gid(5), name: "a2", parent: gid(2) },
    { id: gid(6), name: "b1", parent: gid(3) },
  ];
}

const baseOptions: AuditOptions = {
  root: gid(1),
  depth: "subtree",
  maxItems: 100,
  primaryLanguage: "en",
  languages: [],
  checks: { required: true, links: true, externalLinks: true, images: true, languages: true, publishing: true },
  pageRequiredFields: [],
};

function go(source: AuditSource, overrides: Partial<AuditOptions> = {}, extra: { checkExternal?: ExternalChecker; signal?: AbortSignal; onProgress?: (p: AuditProgress) => void } = {}) {
  return runAudit({ source, environmentName: "Test", options: { ...baseOptions, ...overrides }, now: new Date("2026-11-09T00:00:00Z"), ...extra });
}

describe("runAudit: crawl", () => {
  it("depth item reads only the root and never lists children", async () => {
    const src = new ScriptedSource(tree());
    const result = await go(src, { depth: "item" });
    expect(result.itemsScanned).toBe(1);
    expect(src.calls.children).toEqual([]);
    expect(result.root).toBe("/sitecore/content/root");
  });

  it("depth children reads the root and its direct children", async () => {
    const src = new ScriptedSource(tree());
    const result = await go(src, { depth: "children" });
    expect(result.itemsScanned).toBe(3);
    expect(src.calls.children).toEqual([gid(1)]);
  });

  it("depth subtree reads everything, without listing leaf children", async () => {
    const src = new ScriptedSource(tree());
    const result = await go(src);
    expect(result.itemsScanned).toBe(6);
    expect(result.truncated).toBe(false);
    expect(src.calls.children.sort()).toEqual([gid(1), gid(2), gid(3)].sort());
  });

  it("stops at maxItems, flags truncation, and adds a notice", async () => {
    const result = await go(new ScriptedSource(tree()), { maxItems: 4 });
    expect(result.itemsScanned).toBe(4);
    expect(result.truncated).toBe(true);
    expect(result.notices.join(" ")).toMatch(/Stopped at 4 items/);
  });

  it("an exact fit is not truncated", async () => {
    const result = await go(new ScriptedSource(tree()), { maxItems: 6 });
    expect(result.itemsScanned).toBe(6);
    expect(result.truncated).toBe(false);
    expect(result.notices).toEqual([]);
  });

  it("maxItems 1 on a root with children is truncated", async () => {
    const result = await go(new ScriptedSource(tree()), { maxItems: 1 });
    expect(result.itemsScanned).toBe(1);
    expect(result.truncated).toBe(true);
  });

  it("an item listed under two parents is read once", async () => {
    const src = new ScriptedSource(tree());
    src.extraChildren.set(gid(3), [gid(4)]);
    const result = await go(src);
    expect(result.itemsScanned).toBe(6);
    expect(src.calls.readItems.flat().filter((id) => id === gid(4))).toHaveLength(1);
  });

  it("throws a readable error when the root is not found", async () => {
    await expect(go(new ScriptedSource(tree()), { root: "/sitecore/content/nope" })).rejects.toThrow(/Nothing found at "\/sitecore\/content\/nope" in en/);
  });

  it("reads each item once per language, primary first, ignoring duplicates of the primary", async () => {
    const src = new ScriptedSource(tree());
    const result = await go(src, { depth: "item", languages: ["en", "fr", ""] });
    expect(src.calls.readItems).toHaveLength(2);
    expect(result.versionsScanned).toBe(2);
  });

  it("reports progress through to done", async () => {
    const phases: string[] = [];
    await go(new ScriptedSource(tree()), {}, { onProgress: (p) => phases.push(p.phase) });
    expect(phases[0]).toBe("crawling");
    expect(phases).toContain("reading");
    expect(phases).toContain("templates");
    expect(phases.at(-1)).toBe("done");
  });
});

describe("runAudit: cancellation", () => {
  it("rejects with AuditCancelledError when aborted mid-read", async () => {
    const controller = new AbortController();
    const src = new ScriptedSource(tree());
    src.onReadItems = () => controller.abort();
    const run = go(src, {}, { signal: controller.signal });
    await expect(run).rejects.toBeInstanceOf(AuditCancelledError);
  });

  it("rejects when aborted before the crawl", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(go(new ScriptedSource(tree()), {}, { signal: controller.signal })).rejects.toThrow("Audit cancelled.");
  });
});

describe("runAudit: failures become notices", () => {
  it("a failed read in one language is a notice, and does not invent missing versions", async () => {
    const src = new ScriptedSource(tree());
    src.failReadItems = (language) => language === "fr";
    const result = await go(src, { languages: ["fr"] });
    expect(result.notices.some((n) => /Could not read 6 item\(s\) in fr: boom fr/.test(n))).toBe(true);
    expect(result.issues.filter((i) => i.rule === "language-missing-version")).toEqual([]);
    expect(result.versionsScanned).toBe(6);
  });

  it("a failed read in the primary language skips those items", async () => {
    const src = new ScriptedSource(tree());
    src.failReadItems = () => true;
    const result = await go(src);
    expect(result.issues).toEqual([]);
    expect(result.versionsScanned).toBe(0);
    expect(result.notices).toHaveLength(1);
  });

  it("a failed template read is a notice, and that template's rules are skipped", async () => {
    const src = new ScriptedSource(tree(), [{ id: T_PAGE, name: "Page", path: "/t", baseTemplateIds: [], fields: [tf("Title", { required: true })] }]);
    src.failTemplate = () => true;
    const result = await go(src);
    expect(result.notices).toEqual([`Could not read template ${T_PAGE}: template boom`]);
    expect(result.issues).toEqual([]);
  });

  it("a failed lookup is a notice, not a pile of broken links", async () => {
    const nodes = tree();
    nodes[1].fields = {
      Link: `<link linktype="internal" id="${gid(77)}" />`,
      Hero: `<image mediaid="${gid(78)}" />`,
      Related: `${gid(79)}`,
    };
    const src = new ScriptedSource(nodes);
    src.failLookup = true;
    const result = await go(src, { depth: "item", root: gid(2) });
    expect(result.notices).toEqual(["Could not check 3 reference(s): lookup boom"]);
    expect(result.issues).toEqual([]);
  });

  it("a failing external checker is a notice", async () => {
    const nodes = tree();
    nodes[0].fields = { Link: '<link linktype="external" url="https://example.com/" />' };
    const result = await go(new ScriptedSource(nodes), { depth: "item" }, {
      checkExternal: async () => {
        throw new Error("network down");
      },
    });
    expect(result.notices).toEqual(["External link check failed: network down"]);
    expect(result.issues).toEqual([]);
  });
});

describe("runAudit: references and external links", () => {
  it("links to items inside the audit count as existing even if the lookup misses them", async () => {
    const nodes = tree();
    nodes[1].fields = { Link: `<link linktype="internal" id="${gid(3)}" />` };
    const src = new ScriptedSource(nodes);
    src.lookup = async (refs) => new Map(refs.filter((r) => r !== gid(3)).map((r) => [r, { exists: false, fields: {} }]));
    const result = await go(src);
    expect(result.issues.filter((i) => i.rule === "link-internal-broken")).toEqual([]);
  });

  it("finds a broken internal link end to end", async () => {
    const nodes = tree();
    nodes[1].fields = { Link: `<link linktype="internal" id="${gid(77)}" />` };
    const result = await go(new ScriptedSource(nodes));
    expect(result.issues.map((i) => [i.rule, i.itemId, i.target])).toEqual([["link-internal-broken", gid(2), gid(77)]]);
  });

  it("sends external URLs to the checker in groups, once each", async () => {
    const nodes = tree();
    nodes.forEach((n, i) => (n.fields = { Link: `<link linktype="external" url="https://example.com/${i % 2}" />` }));
    const seen: string[][] = [];
    await go(new ScriptedSource(nodes), {}, {
      checkExternal: async (urls) => {
        seen.push(urls);
        return urls.map((url) => ({ url, ok: true, status: 200, verdict: "ok" as const }));
      },
    });
    expect(seen.flat().sort()).toEqual(["https://example.com/0", "https://example.com/1"]);
  });

  it("does not call the checker when external links (or links) are off", async () => {
    const nodes = tree();
    nodes[0].fields = { Link: '<link linktype="external" url="https://example.com/" />' };
    let called = 0;
    const checkExternal = async () => {
      called++;
      return [];
    };
    await go(new ScriptedSource(nodes), { checks: { ...baseOptions.checks, externalLinks: false } }, { checkExternal });
    await go(new ScriptedSource(nodes), { checks: { ...baseOptions.checks, links: false } }, { checkExternal });
    expect(called).toBe(0);
  });

  it(`caps external URLs at MAX_EXTERNAL_URLS (${MAX_EXTERNAL_URLS}) with a notice`, async () => {
    const nodes = tree();
    const total = MAX_EXTERNAL_URLS + 5;
    nodes[0].fields = {
      Body: `<p>${Array.from({ length: total }, (_, i) => `<a href="https://example.com/${i}">x</a>`).join("")}</p>`,
    };
    const checked: string[] = [];
    const result = await go(new ScriptedSource(nodes), { depth: "item" }, {
      checkExternal: async (urls) => {
        checked.push(...urls);
        return [];
      },
    });
    expect(checked).toHaveLength(MAX_EXTERNAL_URLS);
    expect(result.notices).toContain(`Checked the first ${MAX_EXTERNAL_URLS} of ${total} external URLs.`);
  });
});

describe("runAudit: templates", () => {
  it("enforces a required field defined on a base template", async () => {
    const templates: TemplateDef[] = [
      { id: T_PAGE, name: "Page", path: "/t/page", baseTemplateIds: [T_BASE], fields: [tf("Title")] },
      { id: T_BASE, name: "Base", path: "/t/base", baseTemplateIds: [], fields: [tf("MetaTitle", { required: true })] },
    ];
    const nodes = tree();
    nodes[0].fields = { Title: "x", MetaTitle: "" };
    const src = new ScriptedSource(nodes, templates);
    const result = await go(src, { depth: "item" });
    expect(result.issues.map((i) => [i.rule, i.field])).toEqual([["required-empty", "MetaTitle"]]);
    expect(src.calls.readTemplate.sort()).toEqual([T_PAGE, T_BASE].sort());
  });

  it("survives circular base templates and reads each template once", async () => {
    const templates: TemplateDef[] = [
      { id: T_PAGE, name: "Page", path: "/t/page", baseTemplateIds: [T_BASE], fields: [tf("A", { required: true })] },
      { id: T_BASE, name: "Base", path: "/t/base", baseTemplateIds: [T_PAGE, T_BASE], fields: [tf("B", { required: true })] },
    ];
    const src = new ScriptedSource(tree(), templates);
    const result = await go(src, { depth: "item" });
    expect(result.issues.map((i) => i.field).sort()).toEqual(["A", "B"]);
    expect(src.calls.readTemplate).toHaveLength(2);
  });
});

describe("resolveTemplateFields", () => {
  it("merges base fields with the nearest definition winning", () => {
    const templates = new Map<string, TemplateDef | null>([
      [T_PAGE, { id: T_PAGE, name: "P", path: "", baseTemplateIds: [T_BASE, gid(902)], fields: [tf("Title", { required: true })] }],
      [T_BASE, { id: T_BASE, name: "B", path: "", baseTemplateIds: [gid(903)], fields: [tf("Title"), tf("Meta")] }],
      [gid(902), null],
      [gid(903), { id: gid(903), name: "C", path: "", baseTemplateIds: [T_PAGE], fields: [tf("Deep")] }],
    ]);
    const fields = resolveTemplateFields(T_PAGE, templates);
    expect(fields.map((f) => f.name)).toEqual(["Title", "Meta", "Deep"]);
    expect(fields[0].required).toBe(true);
  });

  it("returns nothing for an unknown template", () => {
    expect(resolveTemplateFields(gid(1), new Map())).toEqual([]);
  });
});

describe("unread items", () => {
  it("treats an item the source could not read as unread, not as a missing language version", async () => {
    const { DemoSource, DEMO_IDS } = await import("@/lib/sitecore/demo-source");
    const { runAudit } = await import("./engine");
    class FlakySource extends DemoSource {
      async readItems(ids: string[], language: string) {
        const out = await super.readItems(ids, language);
        if (language === "fr-CA") out.delete(DEMO_IDS.about);
        return out;
      }
    }
    const result = await runAudit({
      source: new FlakySource(0),
      environmentName: "Demo",
      options: {
        root: DEMO_IDS.about, depth: "item", maxItems: 10, primaryLanguage: "en", languages: ["fr-CA"],
        checks: { required: true, links: true, externalLinks: false, images: true, languages: true, publishing: true },
        pageRequiredFields: [],
      },
    });
    expect(result.issues.filter((i) => i.category === "languages")).toEqual([]);
    expect(result.notices.some((n) => n.includes("Could not read 1 item(s) in fr-CA"))).toBe(true);
  });
});
