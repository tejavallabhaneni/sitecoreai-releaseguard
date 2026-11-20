"use client";

import { AlertCircle, CodeXml, Globe2, ImageOff, Link2Off, ListChecks, Loader2, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuditCancelledError, runAudit, type ExternalChecker } from "@/lib/audit/engine";
import { parseTargets } from "@/lib/audit/targets";
import { APP_NAME, CONTENT_ROOT, DEFAULT_LANGUAGE, DEFAULT_MAX_ITEMS } from "@/lib/config";
import { DemoSource, demoExternalChecker } from "@/lib/sitecore/demo-source";
import { LiveSource } from "@/lib/sitecore/live-source";
import { SitecoreRequestError, errorMessage, isMarketplaceHost, loadSession, onRetry } from "@/lib/sitecore/sdk";
import type { AuditSource } from "@/lib/sitecore/source";
import type { AuditOptions, AuditProgress, AuditResult, Environment, ExternalLinkResult, SiteOption } from "@/lib/types";
import { AppFooter, BrandLockup } from "./brand";
import { ContentTree } from "./content-tree";
import { Results } from "./results";
import { SettingsPanel, type EnvironmentProblem, type ScopeMode } from "./settings-panel";
import { Button, Card } from "./ui";

const DEMO_ENV: Environment = { contextId: "demo", name: "Demo — Northwind Outdoor" };
const SETTINGS_KEY = "releaseguard.settings.v1";
/** The "Specific items" list is per environment: paths differ between them. */
const TARGETS_KEY = "releaseguard.targets.v1.";
/** The environment picked last, so the app reopens on it. */
const ENVIRONMENT_KEY = "releaseguard.environment.v1";

type Boot =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; mode: "demo" | "live"; environments: Environment[]; language: string };

const DEFAULT_OPTIONS: AuditOptions = {
  root: CONTENT_ROOT,
  depth: "subtree",
  maxItems: DEFAULT_MAX_ITEMS,
  primaryLanguage: DEFAULT_LANGUAGE,
  languages: [],
  checks: { required: true, emptyFields: false, links: true, externalLinks: true, images: true, markup: true, languages: true, publishing: true },
  pageRequiredFields: ["Title"],
};

function readStorage(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeStorage(key: string, value: string) {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Storage blocked in this frame: the value just is not remembered.
  }
}

function loadSaved(): Partial<AuditOptions> {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return {};
    const saved = JSON.parse(raw) as Partial<AuditOptions>;
    return {
      ...(saved.checks ? { checks: { ...DEFAULT_OPTIONS.checks, ...saved.checks } } : {}),
      ...(Array.isArray(saved.pageRequiredFields) ? { pageRequiredFields: saved.pageRequiredFields } : {}),
      ...(typeof saved.maxItems === "number" ? { maxItems: saved.maxItems } : {}),
      ...(saved.depth ? { depth: saved.depth } : {}),
    };
  } catch {
    return {};
  }
}

function loadScopeMode(): ScopeMode {
  try {
    const saved = JSON.parse(readStorage(SETTINGS_KEY) || "{}") as { scopeMode?: unknown };
    return saved.scopeMode === "list" ? "list" : "root";
  } catch {
    return "root";
  }
}

function saveSettings(options: AuditOptions, scopeMode: ScopeMode) {
  try {
    const { checks, pageRequiredFields, maxItems, depth } = options;
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ checks, pageRequiredFields, maxItems, depth, scopeMode }));
  } catch {
    // Storage blocked in this frame: settings just are not remembered.
  }
}

const liveExternalChecker: ExternalChecker = async (urls) => {
  const res = await fetch("/api/link-check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ urls }),
  });
  if (!res.ok) throw new Error(`link checker answered HTTP ${res.status}`);
  const body = (await res.json()) as { results?: ExternalLinkResult[] };
  return body.results ?? [];
};

/** The options an audit actually runs with: the list (or none) and trimmed page fields. */
function effectiveOptions(options: AuditOptions, scopeMode: ScopeMode, targetsText: string): AuditOptions {
  return {
    ...options,
    targets: scopeMode === "list" ? parseTargets(targetsText) : [],
    pageRequiredFields: options.pageRequiredFields.map((s) => s.trim()).filter(Boolean),
  };
}

/** What decides an audit's results, so a change can mark the shown results as out of date. */
function scopeKey(o: AuditOptions): string {
  const list = o.targets?.length ? o.targets : null;
  return JSON.stringify({
    scope: list ?? { root: o.root.trim(), depth: o.depth },
    maxItems: o.maxItems,
    primary: o.primaryLanguage,
    languages: [...o.languages].sort(),
    checks: o.checks,
    pageFields: o.pageRequiredFields.map((s) => s.trim()).filter(Boolean),
  });
}

function parentPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 3 ? `/${parts.slice(0, -1).join("/")}` : path;
}

export function ReleaseGuard() {
  const [boot, setBoot] = useState<Boot>({ state: "loading" });
  const [environmentId, setEnvironmentId] = useState("");
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [siteId, setSiteId] = useState("");
  const [languages, setLanguages] = useState<string[]>([]);
  const [loadingScope, setLoadingScope] = useState(true);
  const [options, setOptions] = useState<AuditOptions>(DEFAULT_OPTIONS);
  const [progress, setProgress] = useState<AuditProgress | null>(null);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [runError, setRunError] = useState("");
  const [scopeMode, setScopeMode] = useState<ScopeMode>("root");
  const [targetsText, setTargetsText] = useState("");
  const [treeOpen, setTreeOpen] = useState(false);
  /** Environments that failed a request, by context ID: shown beside the environment picker. */
  const [envProblems, setEnvProblems] = useState<Record<string, EnvironmentProblem>>({});
  const [runStartedAt, setRunStartedAt] = useState(0);
  const [retries, setRetries] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  // Decide the mode once: inside a Sitecore iframe it is the real session, otherwise the demo.
  useEffect(() => {
    let cancelled = false;
    const saved = loadSaved();
    (async () => {
      setScopeMode(loadScopeMode());
      if (!isMarketplaceHost()) {
        if (cancelled) return;
        setOptions((o) => ({ ...o, ...saved }));
        setBoot({ state: "ready", mode: "demo", environments: [DEMO_ENV], language: "en" });
        setEnvironmentId(DEMO_ENV.contextId);
        setTargetsText(readStorage(TARGETS_KEY + DEMO_ENV.contextId));
        return;
      }
      try {
        const session = await loadSession();
        if (cancelled) return;
        if (!session.environments.length) {
          setBoot({
            state: "error",
            message: "This app is not installed on any SitecoreAI environment yet. Install it from Cloud Portal → My apps.",
          });
          return;
        }
        const language = session.language || DEFAULT_LANGUAGE;
        setOptions((o) => ({ ...o, ...saved, primaryLanguage: language }));
        setBoot({ state: "ready", mode: "live", environments: session.environments, language });
        // Reopen on the environment used last, when it is still installed.
        const lastUsed = readStorage(ENVIRONMENT_KEY);
        const start = session.environments.find((e) => e.contextId === lastUsed) ?? session.environments[0];
        setEnvironmentId(start.contextId);
        setTargetsText(readStorage(TARGETS_KEY + start.contextId));
      } catch (error) {
        if (!cancelled) setBoot({ state: "error", message: errorMessage(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const source: AuditSource | null = useMemo(() => {
    if (boot.state !== "ready" || !environmentId) return null;
    if (boot.mode === "demo") return new DemoSource();
    const env = boot.environments.find((e) => e.contextId === environmentId);
    return new LiveSource(environmentId, env?.previewContextId);
  }, [boot, environmentId]);

  const applySite = useCallback(
    async (site: SiteOption | undefined, src: AuditSource, envLanguages: string[]) => {
      if (!site) return;
      let root = site.rootPath ?? "";
      if (!root && site.rootId) {
        try {
          const home = await src.resolve(site.rootId, options.primaryLanguage);
          if (home?.path) root = parentPath(home.path);
        } catch {
          root = site.rootId;
        }
      }
      setOptions((o) => ({
        ...o,
        root: root || o.root,
        languages: (site.languages.length ? site.languages : envLanguages).filter((l) => l !== o.primaryLanguage),
      }));
    },
    [options.primaryLanguage],
  );

  const changeTargets = (text: string) => {
    setTargetsText(text);
    if (environmentId) writeStorage(TARGETS_KEY + environmentId, text);
  };

  const noteProblem = useCallback((contextId: string, error: unknown | null) => {
    setEnvProblems((all) => {
      const next = { ...all };
      if (error === null) delete next[contextId];
      else next[contextId] = { message: errorMessage(error), unreachable: error instanceof SitecoreRequestError && error.unreachable };
      return next;
    });
  }, []);

  // Load sites and languages whenever the environment changes, and check the environment answers.
  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    const contextId = environmentId;
    (async () => {
      const [siteList, langList, problem] = await Promise.all([
        source.listSites().catch(() => [] as SiteOption[]),
        source.listLanguages().catch(() => [] as string[]),
        // One light read: an environment that cannot answer it cannot be audited either.
        source.resolve(CONTENT_ROOT, options.primaryLanguage).then(
          () => null,
          (error: unknown) => error,
        ),
      ]);
      if (cancelled) return;
      noteProblem(contextId, problem);
      setSites(siteList);
      setLanguages(langList);
      setLoadingScope(false);
      const first = siteList[0];
      setSiteId(first?.id ?? "");
      if (first) await applySite(first, source, langList);
      else setOptions((o) => ({ ...o, languages: langList.filter((l) => l !== o.primaryLanguage) }));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the environment changes
  }, [source]);

  const environment =
    boot.state === "ready" ? boot.environments.find((e) => e.contextId === environmentId) ?? boot.environments[0] : null;

  const run = async () => {
    if (!source || !environment) return;
    saveSettings(options, scopeMode);
    setTreeOpen(false);
    setRunStartedAt(Date.now());
    setRetries(0);
    const stopListening = onRetry(() => setRetries((n) => n + 1));
    const controller = new AbortController();
    abortRef.current = controller;
    setRunError("");
    setResult(null);
    setProgress({ phase: "crawling", done: 0, total: 0, message: "Starting…" });
    try {
      const audit = await runAudit({
        source,
        environmentName: environment.name,
        options: effectiveOptions(options, scopeMode, targetsText),
        checkExternal: source.kind === "demo" ? demoExternalChecker : liveExternalChecker,
        onProgress: setProgress,
        signal: controller.signal,
      });
      setResult(audit);
      noteProblem(environment.contextId, null);
    } catch (error) {
      if (!(error instanceof AuditCancelledError)) setRunError(errorMessage(error));
      if (error instanceof SitecoreRequestError) noteProblem(environment.contextId, error);
    } finally {
      stopListening();
      setProgress(null);
      abortRef.current = null;
    }
  };

  const stale = result !== null && scopeKey(result.options) !== scopeKey(effectiveOptions(options, scopeMode, targetsText));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="pg-shadow-base relative z-10 shrink-0 bg-surface">
        <div className="flex h-14 items-center justify-between gap-3 px-4">
          <BrandLockup />
          <div className="flex min-w-0 items-center justify-end gap-2">
            {boot.state === "ready" && boot.mode === "demo" ? (
              <span
                className="whitespace-nowrap rounded-full border border-line-strong px-2.5 py-1 text-xs text-muted"
                title="Offline demo: open this app from SitecoreAI to audit real content."
              >
                Demo data
              </span>
            ) : null}
            {environment ? (
              <span className="hidden min-w-0 items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-muted lg:inline-flex">
                <span className="size-[7px] shrink-0 rounded-full bg-success" aria-hidden="true" />
                <span className="truncate">{environment.name}</span>
              </span>
            ) : null}
          </div>
        </div>
      </header>

      {boot.state === "loading" ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" /> Connecting to SitecoreAI…
        </div>
      ) : boot.state === "error" ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <Card className="max-w-md p-6 text-center">
            <AlertCircle className="mx-auto mb-2 size-8 text-error" />
            <h2 className="mb-1 font-semibold">Could not connect</h2>
            <p className="mb-4 text-sm text-muted">{boot.message}</p>
            <Button onClick={() => window.location.reload()}>Try again</Button>
          </Card>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          <aside className="shrink-0 border-line bg-surface lg:w-[320px] lg:overflow-y-auto lg:border-r">
            <SettingsPanel
              environments={boot.environments}
              environmentId={environmentId}
              environmentProblems={envProblems}
              onEnvironmentChange={(id) => {
                setLoadingScope(true);
                setResult(null);
                // A failed run belongs to the environment it ran on.
                setRunError("");
                setEnvironmentId(id);
                writeStorage(ENVIRONMENT_KEY, id);
                // The "Specific items" list belongs to the environment: paths differ between them.
                setTargetsText(readStorage(TARGETS_KEY + id));
                setTreeOpen(false);
              }}
              sites={sites}
              siteId={siteId}
              onSiteChange={(id) => {
                setSiteId(id);
                if (source) void applySite(sites.find((s) => s.id === id), source, languages);
              }}
              availableLanguages={languages}
              options={options}
              onChange={setOptions}
              running={progress !== null}
              onRun={run}
              onCancel={() => abortRef.current?.abort()}
              loadingScope={loadingScope}
              scopeMode={scopeMode}
              onScopeModeChange={(mode) => {
                setScopeMode(mode);
                if (mode === "root") setTreeOpen(false);
              }}
              targetsText={targetsText}
              onTargetsTextChange={changeTargets}
              treeOpen={treeOpen}
              onBrowseTree={() => setTreeOpen(true)}
            />
          </aside>
          <main className="min-w-0 flex-1 p-4 lg:overflow-y-auto lg:px-7 lg:py-6">
            {progress ? (
              <ProgressView progress={progress} startedAt={runStartedAt} retries={retries} maxItems={options.maxItems} />
            ) : treeOpen && source ? (
              <ContentTree
                key={`${environmentId}|${options.root}`}
                source={source}
                language={options.primaryLanguage}
                rootPath={options.root.trim() || CONTENT_ROOT}
                value={targetsText}
                onChange={changeTargets}
                onClose={() => setTreeOpen(false)}
              />
            ) : runError ? (
              <Card className="border-error/30 bg-error-soft p-4 text-sm">
                <div className="mb-1 flex items-center gap-2 font-semibold text-error">
                  <AlertCircle className="size-4" /> The audit stopped
                </div>
                <p className="break-words text-ink">{runError}</p>
              </Card>
            ) : result ? (
              <Results result={result} stale={stale} />
            ) : (
              <EmptyState demo={boot.mode === "demo"} />
            )}
          </main>
        </div>
      )}
      <AppFooter />
    </div>
  );
}

function elapsedText(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function ProgressView({ progress, startedAt, retries, maxItems }: { progress: AuditProgress; startedAt: number; retries: number; maxItems: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const pct = progress.total ? Math.min(100, Math.round((100 * progress.done) / progress.total)) : null;
  const steps: { phase: AuditProgress["phase"]; label: string }[] = [
    { phase: "crawling", label: "Find items" },
    { phase: "reading", label: "Read content" },
    { phase: "templates", label: "Read templates" },
    { phase: "references", label: "Check references" },
    { phase: "external", label: "Check external links" },
  ];
  const at = steps.findIndex((s) => s.phase === progress.phase);
  return (
    <Card className="mx-auto mt-8 max-w-xl p-6">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
        <Loader2 className="size-4 animate-spin text-brand" /> {progress.message}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-canvas">
        {pct === null ? (
          <div className="pg-cover-band rg-indeterminate h-full w-2/5 rounded-full" />
        ) : (
          <div className="pg-cover-band h-full rounded-full transition-[width]" style={{ width: `${pct}%` }} />
        )}
      </div>
      <p className="mt-2 flex flex-wrap justify-between gap-x-4 text-xs text-muted">
        <span>{progress.phase === "crawling" ? `Item limit ${maxItems.toLocaleString()}` : pct !== null ? `${pct}%` : ""}</span>
        <span className="tabular-nums">{elapsedText(now - startedAt)} elapsed</span>
      </p>
      {retries ? (
        <p role="status" className="mt-2 rounded-[7px] bg-warning-soft px-2.5 py-1.5 text-xs text-ink">
          Sitecore asked for {retries === 1 ? "a request" : `${retries} requests`} to be sent again (usually a failed token exchange). The audit is
          still running.
        </p>
      ) : null}
      <ol className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {steps.map((s, i) => (
          <li key={s.phase} className={i < at ? "text-success" : i === at ? "font-semibold text-navy" : "text-muted"}>
            {i < at ? "✓ " : ""}
            {s.label}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function EmptyState({ demo }: { demo: boolean }) {
  const checks = [
    { Icon: ListChecks, title: "Required content", body: "Empty required fields, failed validation patterns, and page fields you name." },
    { Icon: Link2Off, title: "Links & references", body: "Internal and media links to deleted items, broken external URLs, dead droplists." },
    { Icon: ImageOff, title: "Image descriptions", body: "Images with no alt text on the field or the media item, rich text images without alt." },
    { Icon: CodeXml, title: "Rich text markup", body: "Broken HTML, scripts and embeds in rich text, and formatting pasted from Word or Google Docs." },
    { Icon: Globe2, title: "Languages", body: "Pages missing a language version, and fields left untranslated." },
    { Icon: Send, title: "Publishing", body: "Unapproved workflow states, publishing restrictions, locks, components with missing datasources." },
  ];
  return (
    <div className="mx-auto max-w-3xl py-2">
      <p className="pg-eyebrow">Pre-publishing audit</p>
      <h2 className="mt-1.5 text-[26px] leading-tight font-semibold tracking-[-0.01em]">Audit content before you publish</h2>
      <p className="mt-1.5 max-w-2xl text-sm text-muted">
        Pick a site or starting item, choose the languages it must have, and run the audit. Publish Guard reads content
        from the authoring database and reports everything that would ship broken. It never writes.
      </p>
      {demo ? (
        <p className="mt-4 rounded-[7px] border border-warning-border/40 bg-warning-soft px-3 py-2 text-sm text-ink">
          You are viewing the offline demo. Open {APP_NAME} from SitecoreAI or Cloud Portal to audit your own environments.
        </p>
      ) : null}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {checks.map(({ Icon, title, body }) => (
          <Card key={title} className="flex gap-3 p-4">
            <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-brand-soft">
              <Icon className="size-[18px] text-brand" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-navy">{title}</h3>
              <p className="text-[13px] text-muted">{body}</p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
