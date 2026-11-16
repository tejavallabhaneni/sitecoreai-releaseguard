import { describe, expect, it } from "vitest";
import { formatTarget, listedDepth, nextDepth, parseTargetLine, parseTargets, setListedDepth, targetKey } from "./targets";

const ID = "{11111111-2222-3333-4444-555555555555}";

describe("parseTargetLine", () => {
  it("reads the depth from the suffix", () => {
    expect(parseTargetLine("/sitecore/content/Site/Home/About")).toEqual({ ref: "/sitecore/content/Site/Home/About", depth: "item" });
    expect(parseTargetLine("/sitecore/content/Site/News/*")).toEqual({ ref: "/sitecore/content/Site/News", depth: "children" });
    expect(parseTargetLine("/sitecore/content/Site/Products/**")).toEqual({ ref: "/sitecore/content/Site/Products", depth: "subtree" });
  });

  it("accepts item IDs, with or without a suffix", () => {
    expect(parseTargetLine(`  ${ID}  `)).toEqual({ ref: ID, depth: "item" });
    expect(parseTargetLine(`${ID}/**`)).toEqual({ ref: ID, depth: "subtree" });
  });

  it("ignores blank lines, comments and a bare suffix, and trims trailing slashes", () => {
    expect(parseTargetLine("")).toBeNull();
    expect(parseTargetLine("   ")).toBeNull();
    expect(parseTargetLine("# release 42")).toBeNull();
    expect(parseTargetLine("/**")).toBeNull();
    expect(parseTargetLine("/sitecore/content/Site/Home/")).toEqual({ ref: "/sitecore/content/Site/Home", depth: "item" });
  });
});

describe("parseTargets", () => {
  it("keeps list order and merges duplicates into the widest depth", () => {
    const text = ["/sitecore/content/A", "", "# comment", "/sitecore/content/B/*", "/SITECORE/content/a/**", "/sitecore/content/B"].join("\n");
    expect(parseTargets(text)).toEqual([
      { ref: "/sitecore/content/A", depth: "subtree" },
      { ref: "/sitecore/content/B", depth: "children" },
    ]);
  });

  it("treats IDs written differently as the same item", () => {
    const text = `${ID}\n11111111222233334444555555555555/*\r\n{11111111-2222-3333-4444-555555555555}`;
    expect(parseTargets(text)).toEqual([{ ref: ID, depth: "children" }]);
  });

  it("returns nothing for an empty list", () => {
    expect(parseTargets("")).toEqual([]);
    expect(parseTargets("\n# only a comment\n")).toEqual([]);
  });
});

describe("editing the list from the tree", () => {
  const path = "/sitecore/content/Site/Home/News";

  it("adds an item at the end, keeping other lines and comments as written", () => {
    const text = "# release 42\n/sitecore/content/Site/Home/About\n\n";
    expect(setListedDepth(text, [path, ID], "item", path)).toBe(`# release 42\n/sitecore/content/Site/Home/About\n${path}`);
    expect(setListedDepth("", [path, ID], "item", path)).toBe(path);
  });

  it("changes the depth in place, whether the line uses the path or the ID", () => {
    const text = `/a\n${path}\n/b`;
    expect(setListedDepth(text, [path, ID], "subtree", path)).toBe(`/a\n${path}/**\n/b`);
    const byId = `/a\n${ID}/*\n/b`;
    expect(setListedDepth(byId, [path, ID], "subtree", path)).toBe(`/a\n${ID}/**\n/b`);
  });

  it("removes every line for the item when unticked", () => {
    const text = `${path}\n/a\n${ID}/**`;
    expect(setListedDepth(text, [path, ID], null, path)).toBe("/a");
  });

  it("reports the listed depth by path or ID", () => {
    expect(listedDepth(`/a\n${path}/*`, [path, ID])).toBe("children");
    expect(listedDepth(`${ID.toLowerCase()}/**`, [path, ID])).toBe("subtree");
    expect(listedDepth("/a", [path, ID])).toBeNull();
  });

  it("cycles the depth item → children → subtree → item", () => {
    expect(nextDepth("item")).toBe("children");
    expect(nextDepth("children")).toBe("subtree");
    expect(nextDepth("subtree")).toBe("item");
  });

  it("formats and keys targets", () => {
    expect(formatTarget({ ref: path, depth: "children" })).toBe(`${path}/*`);
    expect(targetKey("11111111222233334444555555555555")).toBe(ID);
    expect(targetKey("/Sitecore/Content")).toBe("/sitecore/content");
  });
});
