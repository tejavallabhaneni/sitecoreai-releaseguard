import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphQlResponse } from "./sdk";
import { REQUIRED_VALIDATOR_ID, STANDARD_TEMPLATE_ID, TEMPLATE_FIELD_TEMPLATE_ID, TEMPLATE_SECTION_TEMPLATE_ID } from "./well-known";

/** Every query sent, in order (the probe included). */
const queries: string[] = [];
let probe: () => GraphQlResponse | Promise<GraphQlResponse>;
let answer: (query: string) => GraphQlResponse | Promise<GraphQlResponse>;
let sites: (operation: string) => unknown[] | Promise<unknown[]>;

vi.mock("./sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sdk")>();
  return {
    ...actual,
    authoringGraphQl: vi.fn(async (_ctx: string, query: string) => {
      queries.push(query);
      return query.includes("RGProbe") ? probe() : answer(query);
    }),
    sitesApi: vi.fn(async (operation: string) => sites(operation)),
  };
});

const { LiveSource } = await import("./live-source");

const ok = (data: Record<string, unknown> | null): GraphQlResponse => ({ data, errors: [] });
const fail = (...errors: string[]): GraphQlResponse => ({ data: null, errors });
const probeWith = (...names: string[]) => () =>
  ok({ itemType: { fields: names.map((name) => ({ name, args: name === "children" ? [{ name: "first" }, { name: "after" }] : [] })) } });
const RICH = ["itemId", "name", "path", "hasChildren", "children", "workflow", "version", "versions"];

const G = (n: number) => `{${String(n).padStart(8, "0")}-0000-4000-8000-000000000000}`;
const raw = (n: number, extra: Record<string, unknown> = {}) => ({
  itemId: G(n).slice(1, -1).toLowerCase(),
  name: `Item ${n}`,
  path: `/sitecore/content/Item ${n}`,
  template: { templateId: G(100).slice(1, -1), name: "Page" },
  fields: { nodes: [{ name: "Title", value: `T${n}` }] },
  ...extra,
});
const work = () => queries.filter((q) => !q.includes("RGProbe"));

beforeEach(() => {
  queries.length = 0;
  probe = probeWith(...RICH);
  answer = () => ok({});
  sites = () => [];
});

describe("capability probe", () => {
  it("introspection failing (throw) leaves the conservative defaults", async () => {
    probe = () => {
      throw new Error("introspection disabled");
    };
    answer = () => ok({ item: { children: { nodes: [raw(1)] } } });
    const src = new LiveSource("ctx");
    const kids = await src.children(G(1), "en");
    expect(kids[0]).toMatchObject({ id: G(1), hasChildren: false, templateId: G(100), templateName: "Page" });
    const q = work()[0];
    expect(q).toContain("itemId");
    expect(q).toContain("hasChildren");
    expect(q).not.toContain("first:");
  });

  it("an empty introspection answer leaves the defaults; rich fields are not requested", async () => {
    probe = () => fail("not allowed");
    answer = () => ok({ i0: raw(1) });
    await new LiveSource("ctx").readItems([G(1)], "en");
    const q = work()[0];
    expect(q).not.toContain("workflow {");
    expect(q).not.toMatch(/^versions?\b/m);
  });

  it("uses `id` when the schema has no `itemId`", async () => {
    probe = probeWith("id", "name", "path");
    answer = () => ok({ item: { id: G(5), name: "x", path: "/x" } });
    const ref = await new LiveSource("ctx").resolve("/x", "en");
    expect(ref).toMatchObject({ id: G(5), hasChildren: true });
    expect(work()[0]).toMatch(/\bid\b/);
    expect(work()[0]).not.toContain("itemId");
  });

  it("probes once per source", async () => {
    answer = () => ok({ item: raw(1) });
    const src = new LiveSource("ctx");
    await src.resolve(G(1), "en");
    await src.resolve(G(1), "en");
    expect(queries.filter((q) => q.includes("RGProbe"))).toHaveLength(1);
  });
});

describe("resolve / children", () => {
  it("resolve queries by ID or by path, and throws on errors without data", async () => {
    answer = () => ok({ item: raw(1, { hasChildren: true }) });
    const src = new LiveSource("ctx");
    expect(await src.resolve(G(1).toLowerCase(), "fr")).toMatchObject({ id: G(1), hasChildren: true });
    expect(work()[0]).toContain(`itemId: "${G(1)}", language: "fr"`);
    await src.resolve("/sitecore/content/home", "en");
    expect(work()[1]).toContain('path: "/sitecore/content/home", language: "en"');
    answer = () => fail("bad path");
    await expect(src.resolve("/x", "en")).rejects.toThrow("bad path");
  });

  it("resolve returns null when nothing is there", async () => {
    answer = () => ok({ item: null });
    expect(await new LiveSource("ctx").resolve("/nope", "en")).toBeNull();
  });

  it("children falls back to unpaged when paging arguments are rejected", async () => {
    answer = (q) => (q.includes("first:") ? fail("Unknown argument first") : ok({ item: { children: { nodes: [raw(1), raw(2), raw(1)] } } }));
    const kids = await new LiveSource("ctx").children(G(9), "en");
    expect(kids.map((k) => k.id)).toEqual([G(1), G(2)]);
    expect(work().filter((q) => q.includes("first:"))).toHaveLength(1);
  });

  it("children de-duplicates across pages and skips nodes without an ID", async () => {
    let page = 0;
    answer = () => {
      page++;
      return ok({
        item: {
          children: {
            nodes: page === 1 ? [raw(1), raw(2)] : [raw(2), raw(3), { name: "no id" }],
            pageInfo: { hasNextPage: page === 1, endCursor: `c${page}` },
          },
        },
      });
    };
    const kids = await new LiveSource("ctx").children(G(9), "en");
    expect(kids.map((k) => k.id)).toEqual([G(1), G(2), G(3)]);
    expect(work()[1]).toContain('after: "c1"');
  });

  it("children throws when an unpaged query fails", async () => {
    probe = probeWith("itemId", "name", "path");
    answer = () => fail("denied");
    await expect(new LiveSource("ctx").children(G(9), "en")).rejects.toThrow("denied");
  });
});

describe("readItems", () => {
  it("sends one aliased query and maps i0..iN back to the requested IDs (null stays null)", async () => {
    answer = () => ok({ i0: raw(1), i1: null, i2: raw(3) });
    const ids = [G(1), G(2), G(3)];
    const out = await new LiveSource("ctx").readItems(ids, "de-DE");
    expect([...out.keys()]).toEqual(ids);
    expect(out.get(G(1))).toMatchObject({ id: G(1), language: "de-DE", fields: { Title: "T1" }, templateId: G(100) });
    expect(out.get(G(2))).toBeNull();
    expect(out.get(G(3))?.name).toBe("Item 3");
    expect(work()).toHaveLength(1);
    expect(work()[0]).toMatch(/i0: item\(where: \{ itemId: "\{00000001-.*language: "de-DE"/);
    expect(work()[0]).toContain("i2: item(");
  });

  it("does not query for an empty list", async () => {
    expect((await new LiveSource("ctx").readItems([], "en")).size).toBe(0);
    expect(work()).toEqual([]);
  });

  it.each([
    ["versions: [] → no version", { versions: [] }, false, null],
    ["version: 0 → no version", { version: 0 }, false, 0],
    ["version: 2 → versioned", { version: 2 }, true, 2],
    ["versions without version → count", { versions: [{ version: 1 }, { version: 2 }] }, true, 2],
    ["versions + version → version wins", { versions: [{ version: 1 }], version: 4 }, true, 4],
    ["neither → unknown", {}, null, null],
  ])("%s", async (_label, extra, hasVersion, version) => {
    answer = () => ok({ i0: raw(1, extra) });
    const item = (await new LiveSource("ctx").readItems([G(1)], "en")).get(G(1));
    expect(item?.hasVersion).toBe(hasVersion);
    expect(item?.version).toBe(version);
  });

  it("maps workflow state and finality", async () => {
    answer = () =>
      ok({
        i0: raw(1, { workflow: { workflowState: { displayName: "Draft", final: false } } }),
        i1: raw(2, { workflow: { workflowState: { displayName: "Approved", final: true } } }),
        i2: raw(3, { workflow: null }),
        i3: raw(4, { workflow: { workflowState: { displayName: "Odd", final: "true" } } }),
      });
    const out = await new LiveSource("ctx").readItems([G(1), G(2), G(3), G(4)], "en");
    expect(out.get(G(1))?.workflow).toEqual({ state: "Draft", final: false });
    expect(out.get(G(2))?.workflow).toEqual({ state: "Approved", final: true });
    expect(out.get(G(3))?.workflow).toBeNull();
    expect(out.get(G(4))?.workflow).toEqual({ state: "Odd", final: false });
  });

  it("maps standard fields by alias and drops empty ones; non-string field values become empty", async () => {
    answer = () =>
      ok({
        i0: raw(1, {
          fields: { nodes: [{ name: "Title", value: "x" }, { name: "Count", value: 5 }, { value: "nameless" }] },
          std_renderings: { value: "<r/>" },
          std_finalRenderings: { value: "" },
          std_neverPublish: { value: "1" },
          std_workflowState: { value: G(40) },
          std_lock: null,
        }),
      });
    const item = (await new LiveSource("ctx").readItems([G(1)], "en")).get(G(1))!;
    expect(item.fields).toEqual({ Title: "x", Count: "" });
    expect(item.std).toEqual({ renderings: "<r/>", neverPublish: "1", workflowState: G(40) });
    const q = work()[0];
    for (const name of ["__Renderings", "__Final Renderings", "__Never publish", "__Publish", "__Unpublish", "__Hide version", "__Valid from", "__Valid to", "__Lock", "__Workflow state"]) {
      expect(q).toContain(`field(name: "${name}")`);
    }
  });

  it("falls back from the rich to the core selection when the first query only returns errors", async () => {
    answer = (q) => (q.includes("workflow {") ? fail("Cannot query field workflow") : ok({ i0: raw(1) }));
    const src = new LiveSource("ctx");
    const out = await src.readItems([G(1)], "en");
    expect(out.get(G(1))?.id).toBe(G(1));
    expect(work()).toHaveLength(2);
    expect(work()[0]).toMatch(/^versions \{ version \}$/m);
    expect(work()[1]).not.toContain("workflow {");
    expect(work()[1]).not.toMatch(/^versions?\b/m);
    // The tier sticks: the next read goes straight to core.
    await src.readItems([G(2)], "en");
    expect(work()).toHaveLength(3);
    expect(work()[2]).not.toContain("workflow {");
  });

  it("throws when the core selection fails too", async () => {
    answer = () => fail("nope");
    await expect(new LiveSource("ctx").readItems([G(1)], "en")).rejects.toThrow("nope");
    expect(work()).toHaveLength(2);
  });
});

describe("readTemplate", () => {
  const fieldNode = (name: string, extra: Record<string, unknown> = {}) => ({
    itemId: G(500).slice(1, -1),
    name,
    template: { templateId: TEMPLATE_FIELD_TEMPLATE_ID },
    type: { value: "Single-Line Text" },
    ...extra,
  });

  it("returns null for the Standard template or a non-ID without querying", async () => {
    const src = new LiveSource("ctx");
    expect(await src.readTemplate(STANDARD_TEMPLATE_ID.toLowerCase())).toBeNull();
    expect(await src.readTemplate("/sitecore/templates/x")).toBeNull();
    expect(work()).toEqual([]);
  });

  it.each([0, 1, 2, 3])("a Required validator in rule field #%i marks the field required", async (slot) => {
    answer = () =>
      ok({
        item: {
          name: "Page",
          path: "/t",
          children: { nodes: [{ name: "Content", children: { nodes: [fieldNode("Title", { [`rules${slot}`]: { value: `{AAAAAAAA-0000-4000-8000-000000000000}|${REQUIRED_VALIDATOR_ID.toLowerCase()}` } })] } }] },
        },
      });
    const def = await new LiveSource("ctx").readTemplate(G(100));
    expect(def?.fields[0]).toMatchObject({ name: "Title", required: true });
  });

  it("parses fields, skips __Standard Values and non-field children, and reads base templates", async () => {
    answer = () =>
      ok({
        item: {
          name: "Page",
          path: "/sitecore/templates/Page",
          baseTemplate: { value: `${G(101)}|${STANDARD_TEMPLATE_ID}|${G(102).toLowerCase()}|` },
          children: {
            nodes: [
              { name: "__Standard Values", children: { nodes: [fieldNode("Ghost")] } },
              {
                name: "Content",
                template: { templateId: TEMPLATE_SECTION_TEMPLATE_ID },
                children: {
                  nodes: [
                    fieldNode("Title", {
                      type: { value: "Rich Text" },
                      shared: { value: "1" },
                      unversioned: { value: "0" },
                      validation: { value: "^.{0,60}$" },
                      validationText: { value: "Too long" },
                    }),
                    fieldNode("Sku", { unversioned: { value: "1" } }),
                    { ...fieldNode("Nested section"), template: { templateId: TEMPLATE_SECTION_TEMPLATE_ID } },
                    { ...fieldNode("Untyped"), template: null },
                    null,
                  ],
                },
              },
            ],
          },
        },
      });
    const def = await new LiveSource("ctx").readTemplate(G(100));
    expect(def).toMatchObject({ id: G(100), name: "Page", path: "/sitecore/templates/Page", baseTemplateIds: [G(101), G(102)] });
    expect(def?.fields.map((f) => f.name)).toEqual(["Title", "Sku", "Untyped"]);
    expect(def?.fields[0]).toEqual({
      id: G(500),
      name: "Title",
      type: "Rich Text",
      section: "Content",
      required: false,
      validation: "^.{0,60}$",
      validationText: "Too long",
      shared: true,
      unversioned: false,
    });
    expect(def?.fields[1]).toMatchObject({ shared: false, unversioned: true, validation: undefined });
  });

  it("returns null for a missing item and throws on errors without data", async () => {
    answer = () => ok({ item: null });
    expect(await new LiveSource("ctx").readTemplate(G(100))).toBeNull();
    answer = () => fail("denied");
    await expect(new LiveSource("ctx").readTemplate(G(100))).rejects.toThrow("denied");
  });
});

describe("lookup", () => {
  it("maps hits, misses, and extra fields from one aliased query", async () => {
    answer = () => ok({ r0: { itemId: G(1), name: "Hero", path: "/sitecore/media library/hero", x0: { value: "Alt text" }, x1: null }, r1: null });
    const out = await new LiveSource("ctx").lookup([G(1), "/sitecore/content/gone"], "en", ["Alt", "Final"]);
    expect(out.get(G(1))).toEqual({ exists: true, id: G(1), name: "Hero", path: "/sitecore/media library/hero", fields: { Alt: "Alt text", Final: "" } });
    expect(out.get("/sitecore/content/gone")).toEqual({ exists: false, fields: {} });
    expect(work()).toHaveLength(1);
    expect(work()[0]).toContain('x0: field(name: "Alt")');
    expect(work()[0]).toContain('r1: item(where: { path: "/sitecore/content/gone"');
  });

  it("answers non-GUID, non-/sitecore refs as missing without querying", async () => {
    const out = await new LiveSource("ctx").lookup(["Data/Hero", "query:./*"], "en", []);
    expect(out.get("Data/Hero")).toEqual({ exists: false, fields: {} });
    expect(out.get("query:./*")).toEqual({ exists: false, fields: {} });
    expect(work()).toEqual([]);
  });

  it("falls back to one at a time when the batch fails", async () => {
    answer = (q) => {
      const count = (q.match(/: item\(/g) ?? []).length;
      if (count > 1) return fail("bad path somewhere");
      if (q.includes("/sitecore/bad")) return fail("bad path");
      return ok({ r0: { itemId: G(1), name: "One", path: "/one" } });
    };
    const out = await new LiveSource("ctx").lookup([G(1), "/sitecore/bad"], "en", []);
    expect(out.get(G(1))).toMatchObject({ exists: true, name: "One" });
    expect(out.get("/sitecore/bad")).toEqual({ exists: false, fields: {} });
    expect(work()).toHaveLength(3);
  });
});

describe("listSites / listLanguages", () => {
  it("maps sites (home page from hosts[0]) and sorts by name", async () => {
    sites = () => [
      { id: "s2", name: "zeta", displayName: "Zeta", hosts: [{ homePageId: G(7).slice(1, -1) }, { homePageId: G(8) }], rootPath: "/sitecore/content/z", languages: ["en", 3, "fr"] },
      { name: "alpha", homePageId: G(9) },
      { id: "nameless" },
      "junk",
    ];
    const out = await new LiveSource("ctx").listSites();
    expect(out).toEqual([
      { id: "alpha", name: "alpha", rootId: G(9), rootPath: undefined, languages: [] },
      { id: "s2", name: "Zeta", rootId: G(7), rootPath: "/sitecore/content/z", languages: ["en", "fr"] },
    ]);
  });

  it("returns [] when the Sites API fails", async () => {
    sites = () => {
      throw new Error("403");
    };
    expect(await new LiveSource("ctx").listSites()).toEqual([]);
  });

  it("reads languages from the Sites API, de-duplicated", async () => {
    sites = () => [{ name: "en" }, { iso: "fr-CA" }, { name: "en" }, {}];
    expect(await new LiveSource("ctx").listLanguages()).toEqual(["en", "fr-CA"]);
    expect(work()).toEqual([]);
  });

  it.each([
    ["fails", () => {
      throw new Error("nope");
    }],
    ["returns nothing", () => []],
  ])("falls back to /sitecore/system/Languages children when the Sites API %s", async (_label, impl) => {
    sites = impl;
    answer = (q) =>
      q.includes("RGResolve")
        ? ok({ item: raw(50, { name: "Languages", hasChildren: true }) })
        : ok({ item: { children: { nodes: [raw(51, { name: "en" }), raw(52, { name: "da" })] } } });
    expect(await new LiveSource("ctx").listLanguages()).toEqual(["en", "da"]);
    expect(work()[0]).toContain('path: "/sitecore/system/Languages"');
  });

  it("returns [] when the languages folder is not there either", async () => {
    sites = () => [];
    answer = () => ok({ item: null });
    expect(await new LiveSource("ctx").listLanguages()).toEqual([]);
  });
});
