import { describe, expect, it } from "vitest";
import { DEMO_IDS, DemoSource, demoExternalChecker } from "@/lib/sitecore/demo-source";
import type { AuditOptions, RuleId } from "@/lib/types";
import { runAudit } from "./engine";
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
