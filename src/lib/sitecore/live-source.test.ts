import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
let childPage: (query: string) => unknown;

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
