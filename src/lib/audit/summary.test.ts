import { describe, expect, it } from "vitest";
import type { AuditResult, Issue, RuleId, Severity } from "@/lib/types";
import { RULES } from "./rules";
import { issuesToCsv, reportFileName, summarize } from "./summary";

function issue(itemId: string, severity: Severity, rule: RuleId = "required-empty", extra: Partial<Issue> = {}): Issue {
  return {
    key: `${rule}|${itemId}|${severity}`,
    rule,
    category: RULES[rule].category,
    severity,
    itemId,
    itemPath: `/sitecore/content/${itemId}`,
    itemName: itemId,
    language: "en",
    message: "m",
    ...extra,
  };
}

describe("summarize", () => {
  it("is ready with no issues, and 0 items scanned is safe", () => {
    expect(summarize({ issues: [], itemsScanned: 10 })).toMatchObject({ verdict: "ready", readiness: 100, itemsWithErrors: 0, itemsWithIssues: 0 });
    expect(summarize({ issues: [], itemsScanned: 0 })).toMatchObject({ verdict: "ready", readiness: 100 });
  });

  it("info-only issues stay ready and do not reduce readiness or count as issues", () => {
    const s = summarize({ issues: [issue("a", "info", "link-insecure"), issue("b", "info", "publish-scheduled")], itemsScanned: 4 });
    expect(s).toMatchObject({ verdict: "ready", readiness: 100, itemsWithIssues: 0, itemsWithErrors: 0 });
    expect(s.bySeverity).toEqual({ error: 0, warning: 0, info: 2 });
  });

  it("warnings need review but do not reduce readiness", () => {
    const s = summarize({ issues: [issue("a", "warning", "publish-locked")], itemsScanned: 4 });
    expect(s).toMatchObject({ verdict: "review", readiness: 100, itemsWithIssues: 1, itemsWithErrors: 0 });
  });

  it("any error blocks; readiness is the share of items without errors, counted per item", () => {
    const s = summarize({
      issues: [issue("a", "error"), issue("a", "error", "link-internal-broken"), issue("b", "error", "image-alt-missing"), issue("c", "warning", "publish-locked")],
      itemsScanned: 3,
    });
    expect(s.verdict).toBe("blocked");
    expect(s.itemsWithErrors).toBe(2);
    expect(s.itemsWithIssues).toBe(3);
    expect(s.readiness).toBe(33);
  });

  it("rounds readiness", () => {
    expect(summarize({ issues: [issue("a", "error")], itemsScanned: 3 }).readiness).toBe(67);
    expect(summarize({ issues: [issue("a", "error")], itemsScanned: 1 }).readiness).toBe(0);
  });

  it("counts by category and severity, with every category present", () => {
    const s = summarize({ issues: [issue("a", "error"), issue("a", "warning", "language-missing-version"), issue("b", "info", "link-insecure")], itemsScanned: 2 });
    expect(s.byCategory).toEqual({
      required: { error: 1, warning: 0, info: 0 },
      links: { error: 0, warning: 0, info: 1 },
      images: { error: 0, warning: 0, info: 0 },
      languages: { error: 0, warning: 1, info: 0 },
      publishing: { error: 0, warning: 0, info: 0 },
    });
  });
});

describe("issuesToCsv", () => {
  it("writes a header and one CRLF-separated row per issue, with labels and titles", () => {
    const csv = issuesToCsv([issue("a", "error", "required-empty", { field: "Title", target: "x" })]);
    const [header, row] = csv.split("\r\n");
    expect(header).toBe("Severity,Category,Check,Item path,Item ID,Language,Field,Message,Target");
    expect(row).toBe("error,Required content,Required field is empty,/sitecore/content/a,a,en,Title,m,x");
  });

  it("header only for no issues", () => {
    expect(issuesToCsv([]).split("\r\n")).toHaveLength(1);
  });

  it("quotes cells with commas, quotes, and newlines, doubling quotes", () => {
    const csv = issuesToCsv([
      issue("a", "warning", "language-untranslated-fields", {
        message: 'He said "hi", then\nleft',
        target: "Title, Body",
        field: "a\rb",
        itemPath: "/plain",
      }),
    ]);
    const row = csv.slice(csv.indexOf("\r\n") + 2);
    expect(row).toBe('warning,Languages,Fields not translated,/plain,a,en,"a\rb","He said ""hi"", then\nleft","Title, Body"');
  });

  it("leaves missing optional cells empty", () => {
    const row = issuesToCsv([issue("a", "info", "link-insecure")]).split("\r\n")[1];
    expect(row.endsWith(",m,")).toBe(true);
    expect(row.split(",")).toHaveLength(9);
  });
});

describe("reportFileName", () => {
  const result = (root: string, finishedAt = "2026-11-09T14:30:59.123Z") => ({ root, finishedAt }) as AuditResult;

  it("uses the last path segment, sanitized, and a minute timestamp", () => {
    expect(reportFileName(result("/sitecore/content/Northwind/Northwind Outdoor"), "csv")).toBe("publish-guard-northwind-outdoor-2026-11-09-14-30.csv");
  });

  it("collapses unsafe characters", () => {
    expect(reportFileName(result("/sitecore/content/A & B (2026)!"), "json")).toBe("publish-guard-a-b-2026-2026-11-09-14-30.json");
  });

  it("falls back to 'audit' for an empty root", () => {
    expect(reportFileName(result("/"), "csv")).toBe("publish-guard-audit-2026-11-09-14-30.csv");
    expect(reportFileName(result(""), "csv")).toBe("publish-guard-audit-2026-11-09-14-30.csv");
  });
});

describe("follow-up hardening", () => {
  it("neutralises spreadsheet formulas in CSV cells", async () => {
    const { issuesToCsv } = await import("./summary");
    const csv = issuesToCsv([
      { key: "k", rule: "link-empty", category: "links", severity: "warning", itemId: "{A}", itemPath: "/p", itemName: "p", language: "en", message: "=HYPERLINK(\"x\")", target: "+1", field: "@f" },
    ]);
    const row = csv.split("\r\n")[1];
    expect(row).toContain(`"'=HYPERLINK(""x"")"`);
    expect(row).toContain("'+1");
    expect(row).toContain("'@f");
  });

  it("names GUID-rooted reports without stray hyphens", async () => {
    const { reportFileName } = await import("./summary");
    const name = reportFileName({ root: "{110D559F-DEA5-42EA-9C1C-8A5DF7E70EF9}", finishedAt: "2026-11-09T10:00:00.000Z" } as never, "csv");
    expect(name).toBe("publish-guard-110d559f-dea5-42ea-9c1c-8a5df7e70ef9-2026-11-09-10-00.csv");
  });
});
