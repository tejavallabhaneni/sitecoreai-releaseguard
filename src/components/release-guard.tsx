"use client";

import { AlertCircle, Globe2, ImageOff, Link2Off, ListChecks, Loader2, Send, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuditCancelledError, runAudit, type ExternalChecker } from "@/lib/audit/engine";
import { APP_NAME, CONTENT_ROOT, DEFAULT_LANGUAGE, DEFAULT_MAX_ITEMS } from "@/lib/config";
import { DemoSource, demoExternalChecker } from "@/lib/sitecore/demo-source";
import { LiveSource } from "@/lib/sitecore/live-source";
import { errorMessage, isMarketplaceHost, loadSession } from "@/lib/sitecore/sdk";
import type { AuditSource } from "@/lib/sitecore/source";
import type { AuditOptions, AuditProgress, AuditResult, Environment, ExternalLinkResult, SiteOption } from "@/lib/types";
import { Results } from "./results";
import { SettingsPanel } from "./settings-panel";
import { Button, Card } from "./ui";

const DEMO_ENV: Environment = { contextId: "demo", name: "Demo — Northwind Outdoor" };
const SETTINGS_KEY = "releaseguard.settings.v1";

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
  checks: { required: true, links: true, externalLinks: true, images: true, languages: true, publishing: true },
  pageRequiredFields: ["Title"],
};

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

function saveSettings(options: AuditOptions) {
  try {
    const { checks, pageRequiredFields, maxItems, depth } = options;
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ checks, pageRequiredFields, maxItems, depth }));
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
  const abortRef = useRef<AbortController | null>(null);

  // Decide the mode once: inside a Sitecore iframe it is the real session, otherwise the demo.
  useEffect(() => {
    let cancelled = false;
    const saved = loadSaved();
    (async () => {
      if (!isMarketplaceHost()) {
        if (cancelled) return;
        setOptions((o) => ({ ...o, ...saved }));
        setBoot({ state: "ready", mode: "demo", environments: [DEMO_ENV], language: "en" });
        setEnvironmentId(DEMO_ENV.contextId);
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
        setEnvironmentId(session.environments[0].contextId);
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
    return boot.mode === "demo" ? new DemoSource() : new LiveSource(environmentId);
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

  // Load sites and languages whenever the environment changes.
  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    (async () => {
      const [siteList, langList] = await Promise.all([
        source.listSites().catch(() => [] as SiteOption[]),
        source.listLanguages().catch(() => [] as string[]),
      ]);
      if (cancelled) return;
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
    saveSettings(options);
    const controller = new AbortController();
    abortRef.current = controller;
    setRunError("");
    setResult(null);
    setProgress({ phase: "crawling", done: 0, total: 0, message: "Starting…" });
    try {
      const audit = await runAudit({
        source,
        environmentName: environment.name,
        options: { ...options, pageRequiredFields: options.pageRequiredFields.map((s) => s.trim()).filter(Boolean) },
        checkExternal: source.kind === "demo" ? demoExternalChecker : liveExternalChecker,
        onProgress: setProgress,
        signal: controller.signal,
      });
      setResult(audit);
    } catch (error) {
      if (!(error instanceof AuditCancelledError)) setRunError(errorMessage(error));
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
        <span className="flex size-8 items-center justify-center rounded-md bg-brand text-white">
          <ShieldCheck className="size-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-[15px] leading-tight font-semibold text-ink">{APP_NAME}</h1>
          <p className="truncate text-xs text-muted">Content quality & pre-publishing audit</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {boot.state === "ready" && boot.mode === "demo" ? (
            <span className="whitespace-nowrap rounded-full bg-warning-soft px-2.5 py-1 text-xs font-medium text-warning" title="Open this app from SitecoreAI to audit real content.">
              Demo data
            </span>
          ) : null}
          {environment ? <span className="hidden truncate text-xs text-muted sm:inline">{environment.name}</span> : null}
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
          <aside className="shrink-0 border-line bg-surface lg:w-[340px] lg:overflow-y-auto lg:border-r">
            <SettingsPanel
              environments={boot.environments}
              environmentId={environmentId}
              onEnvironmentChange={(id) => {
                setLoadingScope(true);
                setResult(null);
                setEnvironmentId(id);
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
            />
          </aside>
          <main className="min-w-0 flex-1 p-4 lg:overflow-y-auto">
            {progress ? (
              <ProgressView progress={progress} />
            ) : runError ? (
              <Card className="border-error/30 bg-error-soft p-4 text-sm">
                <div className="mb-1 flex items-center gap-2 font-semibold text-error">
                  <AlertCircle className="size-4" /> The audit stopped
                </div>
                <p className="text-ink">{runError}</p>
              </Card>
            ) : result ? (
              <Results result={result} />
            ) : (
              <EmptyState demo={boot.mode === "demo"} />
            )}
          </main>
        </div>
      )}
    </div>
  );
}

function ProgressView({ progress }: { progress: AuditProgress }) {
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
          <div className="rg-indeterminate h-full w-2/5 rounded-full bg-brand" />
        ) : (
          <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${pct}%` }} />
        )}
      </div>
      <ol className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {steps.map((s, i) => (
          <li key={s.phase} className={i < at ? "text-success" : i === at ? "font-semibold text-brand" : "text-subtle"}>
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
    { Icon: Globe2, title: "Languages", body: "Pages missing a language version, and fields left untranslated." },
    { Icon: Send, title: "Publishing", body: "Unapproved workflow states, publishing restrictions, locks, components with missing datasources." },
  ];
  return (
    <div className="mx-auto max-w-3xl py-6">
      <h2 className="text-xl font-semibold text-ink">Audit content before you publish</h2>
      <p className="mt-1 text-sm text-muted">
        Pick a site or starting item, choose the languages it must have, and run the audit. ReleaseGuard reads content
        from the authoring database and reports everything that would ship broken. It never writes.
      </p>
      {demo ? (
        <p className="mt-3 rounded-md bg-warning-soft px-3 py-2 text-sm text-ink">
          You are viewing the offline demo. Open {APP_NAME} from SitecoreAI or Cloud Portal to audit your own environments.
        </p>
      ) : null}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {checks.map(({ Icon, title, body }) => (
          <Card key={title} className="flex gap-3 p-4">
            <Icon className="mt-0.5 size-5 shrink-0 text-brand" />
            <div>
              <h3 className="text-sm font-semibold text-ink">{title}</h3>
              <p className="text-[13px] text-muted">{body}</p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
