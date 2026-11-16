"use client";

import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Crosshair,
  Download,
  FileJson,
  Globe2,
  ImageOff,
  Link2Off,
  ListChecks,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_LABELS, RULES } from "@/lib/audit/rules";
import { formatTarget } from "@/lib/audit/targets";
import { downloadText, groupAcrossLanguages, issuesToCsv, issuesToTsv, reportFileName, summarize, type IssueGroup, type Verdict } from "@/lib/audit/summary";
import { isMarketplaceHost } from "@/lib/sitecore/sdk";
import { copyText } from "./clipboard";
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

export function Results({ result, stale = false }: { result: AuditResult; stale?: boolean }) {
  const summary = useMemo(() => summarize(result), [result]);
  const [category, setCategory] = useState<Category | "all">("all");
  const [severities, setSeverities] = useState<Set<Severity>>(new Set(["error", "warning", "info"]));
  const [language, setLanguage] = useState("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState<"csv" | "json" | null>(null);

  // Inside Sitecore the app runs in a sandboxed frame that blocks downloads, so export opens a
  // copy panel there instead. Outside (the demo), the file downloads as usual.
  const exportReport = (format: "csv" | "json") => {
    if (isMarketplaceHost()) {
      setExporting(format);
      return;
    }
    if (format === "csv") downloadText(reportFileName(result, "csv"), issuesToCsv(result.issues), "text/csv");
    else downloadText(reportFileName(result, "json"), JSON.stringify({ ...result, summary }, null, 2), "application/json");
  };

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
    // The same finding in several languages is one row, so a missing translation does not repeat per language.
    return [...map.values()].map((g) => ({ ...g, rows: groupAcrossLanguages(g.issues) }));
  }, [filtered]);
  const rowCount = useMemo(() => groups.reduce((n, g) => n + g.rows.length, 0), [groups]);

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
      {exporting ? (
        <ExportPanel
          format={exporting}
          fileName={reportFileName(result, exporting)}
          text={exporting === "csv" ? issuesToCsv(result.issues) : JSON.stringify({ ...result, summary }, null, 2)}
          table={exporting === "csv" ? issuesToTsv(result.issues) : undefined}
          count={result.issues.length}
          onClose={() => setExporting(null)}
        />
      ) : null}
      {stale ? (
        <p role="status" className="flex items-center gap-2 rounded-[5px] border-l-4 border-info bg-info-soft px-3 py-2 text-sm text-ink">
          <RefreshCw className="size-4 shrink-0 text-info" />
          The settings have changed since this audit ran. These results are for the scope below; run the audit again to update them.
        </p>
      ) : null}
      <AuditScope result={result} />
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
            <Button size="sm" onClick={() => exportReport("csv")}>
              <Download className="size-3.5" /> CSV
            </Button>
            <Button size="sm" onClick={() => exportReport("json")}>
              <FileJson className="size-3.5" /> JSON
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between px-3 py-2 text-xs text-muted">
          <span>
            {plural(rowCount, "finding")} on {plural(groups.length, "item")}
            {rowCount !== filtered.length ? ` (${filtered.length.toLocaleString()} issues across languages)` : ""}
            {filtered.length !== result.issues.length ? `, filtered from ${result.issues.length.toLocaleString()}` : ""}
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
                      <span className="block truncate font-mono text-xs text-muted">{group.itemPath}</span>
                    </span>
                    <CountPill severity="error" count={counts.error} />
                    <CountPill severity="warning" count={counts.warning} />
                    <CountPill severity="info" count={counts.info} />
                  </button>
                  {open ? (
                    <ul className="pb-2">
                      {group.rows.map((row) => (
                        <IssueRow key={row.key} row={row} />
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

/** Language chips: all of them when few, else the first few and a count. */
function LanguageChips({ languages }: { languages: string[] }) {
  const shown = languages.length > 6 ? languages.slice(0, 5) : languages;
  return (
    <>
      {shown.map((l) => (
        <span key={l} className="rounded bg-brand-soft px-1.5 text-xs font-semibold text-navy">
          {l}
        </span>
      ))}
      {shown.length < languages.length ? (
        <span className="rounded bg-brand-soft px-1.5 text-xs font-semibold text-navy" title={languages.slice(shown.length).join(", ")}>
          +{languages.length - shown.length} more
        </span>
      ) : null}
    </>
  );
}

function IssueRow({ row }: { row: IssueGroup }) {
  const { issue } = row;
  const [copied, setCopied] = useState(false);
  const [details, setDetails] = useState(false);
  return (
    <li className="mx-3 flex gap-2.5 rounded-md py-1.5 pr-2 pl-6">
      <SeverityIcon severity={issue.severity} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-[13px] font-bold text-navy">{RULES[issue.rule].title}</span>
          {issue.field ? <span className="rounded bg-canvas px-1.5 text-xs font-medium text-muted">{issue.field}</span> : null}
          <LanguageChips languages={row.languages} />
        </div>
        <p className="text-[13px] text-ink/80">{row.message}</p>
        {row.target ? (
          <div className="mt-0.5 flex min-w-0 items-center gap-1">
            <code className="truncate font-mono text-xs text-ink/80">{row.target}</code>
            <button
              type="button"
              aria-label="Copy"
              className="shrink-0 rounded p-0.5 text-muted hover:text-ink"
              onClick={() => {
                void copyText(row.target ?? "").then((ok) => {
                  if (!ok) return;
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                });
              }}
            >
              {copied ? <CheckCircle2 className="size-3 text-success" /> : <Copy className="size-3" />}
            </button>
          </div>
        ) : null}
        {row.hint ? <p className="mt-0.5 text-xs text-muted">{row.hint}</p> : null}
        {row.perLanguage ? (
          <>
            <button type="button" className="mt-0.5 text-xs font-bold text-info hover:underline" aria-expanded={details} onClick={() => setDetails(!details)}>
              {details ? "Hide each language" : "Show each language"}
            </button>
            {details ? (
              <ul className="mt-1 space-y-0.5 border-l-2 border-line pl-2">
                {row.issues.map((i) => (
                  <li key={i.key} className="text-xs text-ink/80">
                    <span className="font-semibold text-navy">{i.language}:</span> {i.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </div>
    </li>
  );
}

const DEPTH_TEXT: Record<AuditResult["options"]["depth"], string> = {
  item: "this item only",
  children: "item and its children",
  subtree: "item and all descendants",
};

/** What this result covers: environment, scope, languages, checks and when it ran. */
function AuditScope({ result }: { result: AuditResult }) {
  const o = result.options;
  const targets = o.targets ?? [];
  const [showList, setShowList] = useState(false);
  const off = (Object.entries(o.checks) as [keyof typeof o.checks, boolean][])
    .filter(([key, on]) => !on && !(key === "externalLinks" && !o.checks.links))
    .map(([key]) => (key === "externalLinks" ? "external URLs" : CATEGORY_LABELS[key as Category].toLowerCase()));
  const finished = new Date(result.finishedAt);
  return (
    <Card className="px-4 py-3 text-[13px] text-ink">
      <div className="flex items-start gap-2.5">
        <Crosshair className="mt-0.5 size-4 shrink-0 text-navy" />
        <dl className="grid min-w-0 flex-1 grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="font-bold text-navy">Environment</dt>
          <dd className="min-w-0 truncate">{result.environment}</dd>
          <dt className="font-bold text-navy">Audited</dt>
          <dd className="min-w-0">
            {targets.length ? (
              <>
                {plural(targets.length, "listed item")}
                <button type="button" className="ml-2 text-xs font-bold text-info hover:underline" aria-expanded={showList} onClick={() => setShowList(!showList)}>
                  {showList ? "Hide list" : "Show list"}
                </button>
                {showList ? (
                  <ul className="mt-1 max-h-40 overflow-y-auto font-mono text-xs text-ink/80">
                    {targets.map((t) => (
                      <li key={formatTarget(t)} className="truncate">
                        {formatTarget(t)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <>
                <span className="font-mono text-xs break-all">{result.root}</span> <span className="text-muted">({DEPTH_TEXT[o.depth]})</span>
              </>
            )}
            {result.truncated ? <span className="text-warning"> · stopped at {o.maxItems} items</span> : null}
          </dd>
          <dt className="font-bold text-navy">Languages</dt>
          <dd className="min-w-0">
            {o.primaryLanguage} <span className="text-muted">(primary)</span>
            {o.languages.length ? `, ${o.languages.join(", ")}` : ""}
          </dd>
          <dt className="font-bold text-navy">Checks</dt>
          <dd className="min-w-0">{off.length ? `All except ${off.join(", ")}` : "All"}</dd>
        </dl>
        <span className="shrink-0 text-xs text-muted" title={finished.toLocaleString()}>
          {finished.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </span>
      </div>
    </Card>
  );
}

/**
 * Export inside Sitecore: the frame blocks downloads, so the report is copied instead. The CSV
 * also comes tab-separated, which Excel and Google Sheets split into columns on paste.
 */
function ExportPanel(props: { format: "csv" | "json"; fileName: string; text: string; table?: string; count: number; onClose: () => void }) {
  const { format, fileName, text, table, count, onClose } = props;
  const [status, setStatus] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const copy = async (value: string, what: string) => {
    const ok = await copyText(value);
    setStatus(ok ? `Copied ${what}.` : "This browser blocked copying. Click in the box, select all, and copy.");
  };
  const label = format === "csv" ? "CSV" : "JSON";
  return (
    <Card className="border-info/40 p-4">
      <div role="dialog" aria-modal="false" aria-labelledby="export-title" className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="export-title" className="text-sm font-bold text-navy">
              Export {count.toLocaleString()} issues as {label}
            </h2>
            <p className="mt-0.5 text-[13px] text-ink/80">
              Sitecore runs Publish Guard in a frame that does not allow downloads, so copy the report instead.
              {format === "csv"
                ? " Paste the table into Excel or Google Sheets, or paste the CSV text into a file named "
                : " Paste it into a file named "}
              <code className="font-mono text-xs">{fileName}</code>.
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close export">
            <X className="size-3.5" /> Close
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {table ? (
            <Button size="sm" variant="primary" onClick={() => void copy(table, "the table for Excel or Sheets")}>
              <Copy className="size-3.5" /> Copy for Excel or Sheets
            </Button>
          ) : null}
          <Button size="sm" variant={table ? "secondary" : "primary"} onClick={() => void copy(text, `the ${label}`)}>
            <Copy className="size-3.5" /> Copy {label}
          </Button>
          <span role="status" className="text-xs text-muted">
            {status}
          </span>
        </div>
        <textarea
          ref={area}
          readOnly
          value={text}
          rows={8}
          spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
          aria-label={`${label} report`}
          className="w-full resize-y rounded-[5px] border border-control bg-canvas px-2.5 py-2 font-mono text-xs leading-5 text-ink focus:border-info focus:outline-none"
        />
      </div>
    </Card>
  );
}
