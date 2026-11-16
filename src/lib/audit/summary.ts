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
  return `publish-guard-${scope}-${stamp}.${ext}`;
}

/** One finding shown once for every language it occurs in. */
export interface IssueGroup {
  key: string;
  /** The first issue; severity, rule, item and field are the same for all. */
  issue: Issue;
  languages: string[];
  issues: Issue[];
  message: string;
  hint?: string;
  target?: string;
  /** The messages differ per language, so each can be shown on request. */
  perLanguage: boolean;
}

/**
 * The same finding on the same item in several languages becomes one row. Language checks are
 * matched on rule, item and field (their message and target name the language); every other check
 * also on its target, so two different broken links in one field stay two rows.
 */
export function groupAcrossLanguages(issues: Issue[]): IssueGroup[] {
  const groups = new Map<string, Issue[]>();
  for (const issue of issues) {
    const target = issue.category === "languages" ? "" : (issue.target ?? "");
    const key = [issue.severity, issue.rule, issue.itemId, issue.field ?? "", target].join("|");
    const list = groups.get(key);
    if (list) list.push(issue);
    else groups.set(key, [issue]);
  }
  return [...groups.entries()].map(([key, list]) => {
    const first = list[0];
    const languages = [...new Set(list.map((i) => i.language))];
    const same = (pick: (i: Issue) => string | undefined) => list.every((i) => pick(i) === pick(first));
    const sameMessage = same((i) => i.message);
    let message = first.message;
    let hint = same((i) => i.hint) ? first.hint : undefined;
    if (!sameMessage && first.rule === "language-missing-version") {
      message =
        first.severity === "error"
          ? `This page has no version in ${languages.length} languages: it will not be available in them.`
          : `No version in ${languages.length} languages.`;
      hint = "Add a version in each of these languages and translate it.";
    } else if (!sameMessage) {
      message = `${RULES[first.rule].title} in ${languages.length} languages.`;
    }
    return {
      key,
      issue: first,
      languages,
      issues: list,
      message,
      hint,
      target: same((i) => i.target) ? first.target : undefined,
      perLanguage: !sameMessage,
    };
  });
}
