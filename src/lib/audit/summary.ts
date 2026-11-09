import type { AuditResult, Category, Issue, Severity } from "@/lib/types";
import { CATEGORY_LABELS, RULES } from "./rules";

export type Verdict = "ready" | "review" | "blocked";

export interface AuditSummary {
  verdict: Verdict;
  /** Share of scanned items with no errors, 0-100. */
  readiness: number;
  bySeverity: Record<Severity, number>;
  byCategory: Record<Category, Record<Severity, number>>;
  itemsWithErrors: number;
  itemsWithIssues: number;
}

const CATEGORIES = Object.keys(CATEGORY_LABELS) as Category[];

export function summarize(result: Pick<AuditResult, "issues" | "itemsScanned">): AuditSummary {
  const bySeverity: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  const byCategory = Object.fromEntries(
    CATEGORIES.map((c) => [c, { error: 0, warning: 0, info: 0 }]),
  ) as Record<Category, Record<Severity, number>>;
  const withErrors = new Set<string>();
  const withIssues = new Set<string>();
  for (const issue of result.issues) {
    bySeverity[issue.severity]++;
    byCategory[issue.category][issue.severity]++;
    if (issue.severity === "error") withErrors.add(issue.itemId);
    if (issue.severity !== "info") withIssues.add(issue.itemId);
  }
  const scanned = Math.max(result.itemsScanned, 1);
  return {
    verdict: bySeverity.error ? "blocked" : bySeverity.warning ? "review" : "ready",
    readiness: Math.round((100 * (scanned - withErrors.size)) / scanned),
    bySeverity,
    byCategory,
    itemsWithErrors: withErrors.size,
    itemsWithIssues: withIssues.size,
  };
}

function csvCell(value: string | undefined): string {
  let v = value ?? "";
  // Spreadsheet formula injection: content authors control these strings.
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function issuesToCsv(issues: Issue[]): string {
  const header = ["Severity", "Category", "Check", "Item path", "Item ID", "Language", "Field", "Message", "Target"];
  const rows = issues.map((i) =>
    [i.severity, CATEGORY_LABELS[i.category], RULES[i.rule].title, i.itemPath, i.itemId, i.language, i.field, i.message, i.target]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...rows].join("\r\n");
}

export function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function reportFileName(result: AuditResult, ext: string): string {
  const stamp = result.finishedAt.slice(0, 16).replace(/[:T]/g, "-");
  const scope = (result.root.split("/").filter(Boolean).pop() || "audit").replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "audit";
  return `releaseguard-${scope}-${stamp}.${ext}`;
}
