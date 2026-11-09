"use client";

import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileJson,
  Globe2,
  ImageOff,
  Link2Off,
  ListChecks,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from "lucide-react";
import { useMemo, useState } from "react";
import { CATEGORY_LABELS, RULES } from "@/lib/audit/rules";
import { downloadText, issuesToCsv, reportFileName, summarize, type Verdict } from "@/lib/audit/summary";
import type { AuditResult, Category, Issue, Severity } from "@/lib/types";
import { cn, plural } from "@/lib/utils";
import { Button, Card, Chip, CountPill, Input, SEVERITY_STYLE, Select, SeverityIcon } from "./ui";

const CATEGORY_ICONS: Record<Category, typeof ListChecks> = {
  required: ListChecks,
  links: Link2Off,
  images: ImageOff,
  languages: Globe2,
  publishing: Send,
};

const VERDICT: Record<Verdict, { title: string; body: string; Icon: typeof ShieldCheck; tone: string }> = {
  blocked: {
    title: "Not ready to publish",
    body: "Errors below will break pages, links, or accessibility once published.",
    Icon: ShieldAlert,
    tone: "border-error/30 bg-error-soft text-error",
  },
  review: {
    title: "Ready, with warnings",
    body: "Nothing blocks the release, but some content needs a look.",
    Icon: ShieldQuestion,
    tone: "border-warning/30 bg-warning-soft text-warning",
  },
  ready: {
    title: "Ready to publish",
    body: "No errors or warnings found in this scope.",
    Icon: ShieldCheck,
    tone: "border-success/30 bg-success-soft text-success",
  },
};

const PAGE = 60;

export function Results({ result }: { result: AuditResult }) {
  const summary = useMemo(() => summarize(result), [result]);
  const [category, setCategory] = useState<Category | "all">("all");
  const [severities, setSeverities] = useState<Set<Severity>>(new Set(["error", "warning", "info"]));
  const [language, setLanguage] = useState("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const languages = useMemo(() => [...new Set(result.issues.map((i) => i.language))].sort(), [result]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return result.issues.filter(
      (i) =>
        severities.has(i.severity) &&
        (category === "all" || i.category === category) &&
        (language === "all" || i.language === language) &&
        (!q ||
          i.itemPath.toLowerCase().includes(q) ||
          i.message.toLowerCase().includes(q) ||
          (i.field ?? "").toLowerCase().includes(q) ||
          (i.target ?? "").toLowerCase().includes(q) ||
          RULES[i.rule].title.toLowerCase().includes(q)),
    );
  }, [result, severities, category, language, query]);

  const groups = useMemo(() => {
    const map = new Map<string, { itemId: string; itemPath: string; itemName: string; issues: Issue[] }>();
    for (const issue of filtered) {
      const g = map.get(issue.itemId) ?? { itemId: issue.itemId, itemPath: issue.itemPath, itemName: issue.itemName, issues: [] };
      g.issues.push(issue);
      map.set(issue.itemId, g);
    }
    return [...map.values()];
  }, [filtered]);

  const verdict = VERDICT[summary.verdict];
  const seconds = Math.max(1, Math.round((Date.parse(result.finishedAt) - Date.parse(result.startedAt)) / 1000));

  const toggleSeverity = (s: Severity) =>
    setSeverities((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next.size ? next : new Set([s]);
    });

  return (
    <div className="flex flex-col gap-4">
      <div className={cn("flex flex-wrap items-center gap-4 rounded-[5px] border p-4", verdict.tone)}>
        <verdict.Icon className="size-9 shrink-0" />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">{verdict.title}</h2>
          <p className="text-sm text-ink/80">{verdict.body}</p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-semibold tabular-nums">{summary.readiness}%</div>
          <div className="text-xs text-ink/70">items without errors</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Items scanned" value={result.itemsScanned.toLocaleString()} sub={`${result.versionsScanned.toLocaleString()} language versions · ${seconds}s`} />
        <Stat label="Errors" value={summary.bySeverity.error} sub={`on ${plural(summary.itemsWithErrors, "item")}`} tone="text-error" />
        <Stat label="Warnings" value={summary.bySeverity.warning} tone="text-warning" />
        <Stat label="Info" value={summary.bySeverity.info} tone="text-info" />
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
        {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => {
          const counts = summary.byCategory[c];
          const Icon = CATEGORY_ICONS[c];
          const enabled = c === "links" ? result.options.checks.links : result.options.checks[c];
          const total = counts.error + counts.warning + counts.info;
          return (
            <button
              key={c}
              type="button"
              disabled={!enabled}
              onClick={() => setCategory(category === c ? "all" : c)}
              className={cn(
                "flex flex-col gap-2 rounded-[5px] border bg-surface p-3 text-left transition-colors disabled:opacity-50",
                category === c ? "border-navy ring-1 ring-navy" : "border-line hover:border-line-strong",
              )}
            >
              <span className="flex items-center gap-2 text-[13px] font-bold text-navy">
                <Icon className="size-4 text-muted" /> {CATEGORY_LABELS[c]}
              </span>
              <span className="flex items-center gap-1.5">
                {!enabled ? (
                  <span className="text-xs text-muted">Not checked</span>
                ) : total === 0 ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                    <CheckCircle2 className="size-3.5" /> All clear
                  </span>
                ) : (
                  <>
                    <CountPill severity="error" count={counts.error} />
                    <CountPill severity="warning" count={counts.warning} />
                    <CountPill severity="info" count={counts.info} />
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {result.notices.length ? (
        <Card className="border-warning/30 bg-warning-soft p-3 text-sm text-ink">
          <ul className="list-disc pl-5">
            {result.notices.slice(0, 8).map((n) => (
              <li key={n}>{n}</li>
            ))}
            {result.notices.length > 8 ? <li>…and {result.notices.length - 8} more.</li> : null}
          </ul>
        </Card>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-subtle" />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(PAGE);
              }}
              placeholder="Filter by path, field, message, URL…"
              className="pl-8"
              aria-label="Filter issues"
            />
          </div>
          {(["error", "warning", "info"] as Severity[]).map((s) => (
            <Chip key={s} active={severities.has(s)} onClick={() => toggleSeverity(s)}>
              <SeverityIcon severity={s} className="size-3.5" />
              {SEVERITY_STYLE[s].label}
            </Chip>
          ))}
          {languages.length > 1 ? (
            <Select value={language} onChange={(e) => setLanguage(e.target.value)} className="h-7 w-auto text-xs" aria-label="Language">
              <option value="all">All languages</option>
              {languages.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          ) : null}
          {category !== "all" ? (
            <Chip active onClick={() => setCategory("all")}>
              {CATEGORY_LABELS[category]} ✕
            </Chip>
          ) : null}
          <div className="ml-auto flex gap-1.5">
            <Button size="sm" onClick={() => downloadText(reportFileName(result, "csv"), issuesToCsv(result.issues), "text/csv")}>
              <Download className="size-3.5" /> CSV
            </Button>
            <Button
              size="sm"
              onClick={() =>
                downloadText(
                  reportFileName(result, "json"),
                  JSON.stringify({ ...result, summary }, null, 2),
                  "application/json",
                )
              }
            >
              <FileJson className="size-3.5" /> JSON
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between px-3 py-2 text-xs text-muted">
          <span>
            {plural(filtered.length, "issue")} on {plural(groups.length, "item")}
            {filtered.length !== result.issues.length ? ` (of ${result.issues.length.toLocaleString()})` : ""}
          </span>
          {groups.length > 1 ? (
            <button
              type="button"
              className="font-bold text-info hover:underline"
              onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(groups.map((g) => g.itemId)))}
            >
              {collapsed.size ? "Expand all" : "Collapse all"}
            </button>
          ) : null}
        </div>

        {groups.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-sm text-muted">
            <CheckCircle2 className="size-8 text-success" />
            {result.issues.length ? "No issues match these filters." : "No issues found."}
          </div>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {groups.slice(0, limit).map((group) => {
              const open = !collapsed.has(group.itemId);
              const counts = { error: 0, warning: 0, info: 0 } as Record<Severity, number>;
              group.issues.forEach((i) => counts[i.severity]++);
              return (
                <li key={group.itemId}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-canvas"
                    aria-expanded={open}
                    onClick={() =>
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(group.itemId)) next.delete(group.itemId);
                        else next.add(group.itemId);
                        return next;
                      })
                    }
                  >
                    {open ? <ChevronDown className="size-4 text-subtle" /> : <ChevronRight className="size-4 text-subtle" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{group.itemName}</span>
                      <span className="block truncate font-mono text-[11px] text-muted">{group.itemPath}</span>
                    </span>
                    <CountPill severity="error" count={counts.error} />
                    <CountPill severity="warning" count={counts.warning} />
                    <CountPill severity="info" count={counts.info} />
                  </button>
                  {open ? (
                    <ul className="pb-2">
                      {group.issues.map((issue) => (
                        <IssueRow key={issue.key} issue={issue} />
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {groups.length > limit ? (
          <div className="border-t border-line p-3 text-center">
            <Button size="sm" onClick={() => setLimit(limit + PAGE * 2)}>
              Show more ({groups.length - limit} items left)
            </Button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: number | string; sub?: string; tone?: string }) {
  return (
    <Card className="p-3">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={cn("text-2xl font-semibold tabular-nums", tone)}>{typeof value === "number" ? value.toLocaleString() : value}</div>
      {sub ? <div className="text-xs text-muted">{sub}</div> : null}
    </Card>
  );
}

function IssueRow({ issue }: { issue: Issue }) {
  const [copied, setCopied] = useState(false);
  return (
    <li className="mx-3 flex gap-2.5 rounded-md py-1.5 pr-2 pl-6">
      <SeverityIcon severity={issue.severity} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[13px] font-bold text-navy">{RULES[issue.rule].title}</span>
          {issue.field ? <span className="rounded bg-canvas px-1.5 text-[11px] font-medium text-muted">{issue.field}</span> : null}
          <span className="rounded bg-brand-soft px-1.5 text-[11px] font-semibold text-navy">{issue.language}</span>
        </div>
        <p className="text-[13px] text-muted">{issue.message}</p>
        {issue.target ? (
          <div className="mt-0.5 flex min-w-0 items-center gap-1">
            <code className="truncate font-mono text-[11px] text-ink/80">{issue.target}</code>
            <button
              type="button"
              aria-label="Copy"
              className="shrink-0 rounded p-0.5 text-subtle hover:text-ink"
              onClick={() => {
                navigator.clipboard?.writeText(issue.target ?? "").then(
                  () => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                  },
                  () => {},
                );
              }}
            >
              {copied ? <CheckCircle2 className="size-3 text-success" /> : <Copy className="size-3" />}
            </button>
          </div>
        ) : null}
        {issue.hint ? <p className="mt-0.5 text-[11px] text-subtle">{issue.hint}</p> : null}
      </div>
    </li>
  );
}
