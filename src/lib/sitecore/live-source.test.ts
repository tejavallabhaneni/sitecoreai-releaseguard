import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
let childPage: (query: string) => unknown;
const previewCalls: { ctx: string; variables: unknown }[] = [];
let previewIcon: string | Error = "";

vi.mock("./sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sdk")>();
  return {
    ...actual,
    authoringGraphQl: vi.fn(async (_ctx: string, query: string) => {
      calls.push(query);
      if (query.includes("__type")) {
        return {
          data: { itemType: { fields: ["itemId", "name", "path", "hasChildren", "children"].map((name) => ({ name, args: name === "children" ? [{ name: "first" }, { name: "after" }] : [] })) } },
          errors: [],
        };
      }
      return { data: childPage(query) as Record<string, unknown>, errors: [] };
    }),
    previewGraphQl: vi.fn(async (ctx: string, _query: string, variables: unknown) => {
      previewCalls.push({ ctx, variables });
      if (previewIcon instanceof Error) throw previewIcon;
      return { data: { item: { icon: previewIcon } }, errors: [] };
    }),
  };
});

const { LiveSource } = await import("./live-source");

const node = (n: number) => ({
  itemId: `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`,
  name: `Item ${n}`,
  path: `/sitecore/content/x/Item ${n}`,
  hasChildren: false,
  template: { templateId: "11111111-0000-4000-8000-000000000000", name: "T" },
});

describe("LiveSource.children paging", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("stops when the server repeats the same cursor", async () => {
    childPage = () => ({ item: { children: { nodes: [node(1), node(2)], pageInfo: { hasNextPage: true, endCursor: "same" } } } });
    const kids = await new LiveSource("ctx").children("{00000001-0000-4000-8000-000000000000}", "en");
    expect(kids.map((k) => k.name)).toEqual(["Item 1", "Item 2"]);
    expect(calls.filter((q) => q.includes("RGChildren")).length).toBeLessThanOrEqual(2);
  });

  it("stops paging once it has enough items", async () => {
    let page = 0;
    childPage = () => {
      page++;
      const start = (page - 1) * 100;
      return {
        item: {
          children: {
            nodes: Array.from({ length: 100 }, (_, i) => node(start + i + 10)),
            pageInfo: { hasNextPage: true, endCursor: `c${page}` },
          },
        },
      };
    };
    const kids = await new LiveSource("ctx").children("{00000001-0000-4000-8000-000000000000}", "en", 150);
    expect(kids).toHaveLength(150);
    expect(page).toBe(2);
  });
});

describe("LiveSource.withIcons", () => {
  const CM = "https://xmc-cm.sitecorecloud.io";
  const ref = (n: number, extra: Partial<{ path: string; hasChildren: boolean }> = {}) => ({
    id: `{${String(n).padStart(8, "0")}-0000-4000-8000-000000000000}`,
    name: `Item ${n}`,
    path: extra.path ?? `/sitecore/content/x/Item ${n}`,
    hasChildren: extra.hasChildren ?? false,
  });

  beforeEach(() => {
    calls.length = 0;
    previewCalls.length = 0;
    previewIcon = "";
  });

  it("learns the CM host once from the preview API and builds icon URLs from relative paths", async () => {
    previewIcon = `${CM}/-/icon/Office/32x32/document.png`;
    childPage = (q) => (q.includes("RGIcons") ? { i0: { icon: "Office/32x32/folder.png" }, i1: { icon: "Office/32x32/document.png" } } : {});
    const source = new LiveSource("live", "preview");
    const out = await source.withIcons([ref(1, { hasChildren: true }), ref(2)], "en");
    expect(out[0].icons).toEqual([`${CM}/temp/iconcache/office/16x16/folder.png`, `${CM}/-/icon/Office/16x16/folder.png`]);
    expect(out[1].icons?.[0]).toBe(`${CM}/temp/iconcache/office/16x16/document.png`);
    expect(previewCalls).toHaveLength(1);
    expect(previewCalls[0].ctx).toBe("preview");
    await source.withIcons([ref(3)], "en");
    expect(previewCalls).toHaveLength(1);
  });

  it("uses an absolute icon URL without asking the preview API", async () => {
    childPage = (q) => (q.includes("RGIcons") ? { i0: { icon: `${CM}/-/icon/Office/16x16/document.png` } } : {});
    const out = await new LiveSource("live", "preview").withIcons([ref(1)], "en");
    expect(out[0].icons?.[0]).toBe(`${CM}/temp/iconcache/office/16x16/document.png`);
    expect(previewCalls).toHaveLength(0);
  });

  it("puts a media item's thumbnail first", async () => {
    childPage = (q) =>
      q.includes("thumbnailUrl")
        ? { i0: { thumbnailUrl: "/-/media/abc.ashx?h=16" } }
        : q.includes("RGIcons")
          ? { i0: { icon: `${CM}/-/icon/Office/16x16/photo.png` } }
          : {};
    const out = await new LiveSource("live").withIcons([ref(1, { path: "/sitecore/media library/hero" })], "en");
    expect(out[0].icons?.[0]).toBe(`${CM}/-/media/abc.ashx?h=16`);
  });

  it("leaves rows as they were when the host or the query cannot help", async () => {
    previewIcon = new Error("no preview");
    childPage = (q) => (q.includes("RGIcons") ? { i0: { icon: "Office/16x16/folder.png" } } : {});
    const rows = [ref(1)];
    expect(await new LiveSource("live", "preview").withIcons(rows, "en")).toEqual(rows);
    expect(await new LiveSource("live").withIcons(rows, "en")).toEqual(rows);
    childPage = () => {
      throw new Error("boom");
    };
    expect(await new LiveSource("live", "preview").withIcons(rows, "en")).toEqual(rows);
    expect(await new LiveSource("live").withIcons([], "en")).toEqual([]);
  });

  it("asks in batches of 25", async () => {
    childPage = () => ({});
    const rows = Array.from({ length: 30 }, (_, i) => ref(i + 1));
    await new LiveSource("live").withIcons(rows, "en");
    expect(calls.filter((q) => q.includes("RGIcons"))).toHaveLength(2);
  });
});
