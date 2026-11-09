import { BATCH_SIZE, CONCURRENCY, MAX_EXTERNAL_URLS } from "@/lib/config";
import type { AuditSource } from "@/lib/sitecore/source";
import type {
  AuditItem,
  AuditOptions,
  AuditProgress,
  AuditResult,
  ExternalLinkResult,
  ItemRef,
  ReferenceInfo,
  TemplateDef,
  TemplateField,
} from "@/lib/types";
import { collectReferences, evaluate } from "./rules";

export type ExternalChecker = (urls: string[]) => Promise<ExternalLinkResult[]>;

export interface RunAuditArgs {
  source: AuditSource;
  environmentName: string;
  options: AuditOptions;
  checkExternal?: ExternalChecker;
  onProgress?: (progress: AuditProgress) => void;
  signal?: AbortSignal;
  now?: Date;
}

export class AuditCancelledError extends Error {
  constructor() {
    super("Audit cancelled.");
    this.name = "AuditCancelledError";
  }
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Run `task` over `inputs` with at most `limit` in flight. */
async function pool<T>(inputs: T[], limit: number, task: (input: T) => Promise<void>, signal?: AbortSignal) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, inputs.length) }, async () => {
    while (next < inputs.length) {
      if (signal?.aborted) throw new AuditCancelledError();
      const input = inputs[next++];
      await task(input);
    }
  });
  await Promise.all(workers);
}

/** Own fields plus every base template's, nearest definition winning. */
export function resolveTemplateFields(id: string, templates: Map<string, TemplateDef | null>): TemplateField[] {
  const out = new Map<string, TemplateField>();
  const visited = new Set<string>();
  const walk = (tid: string) => {
    if (visited.has(tid)) return;
    visited.add(tid);
    const def = templates.get(tid);
    if (!def) return;
    for (const field of def.fields) if (!out.has(field.name)) out.set(field.name, field);
    for (const baseId of def.baseTemplateIds) walk(baseId);
  };
  walk(id);
  return [...out.values()];
}

export async function runAudit(args: RunAuditArgs): Promise<AuditResult> {
  const { source, options, signal } = args;
  const progress = args.onProgress ?? (() => {});
  const startedAt = new Date().toISOString();
  const notices: string[] = [];
  const primary = options.primaryLanguage;
  const languages = [primary, ...options.languages.filter((l) => l && l !== primary)];
  const check = () => {
    if (signal?.aborted) throw new AuditCancelledError();
  };

  // 1. Crawl.
  progress({ phase: "crawling", done: 0, total: 0, message: "Finding the starting item…" });
  const root = await source.resolve(options.root.trim(), primary);
  if (!root) throw new Error(`Nothing found at "${options.root}" in ${primary}. Check the path or ID.`);
  const refs: ItemRef[] = [root];
  const seen = new Set([root.id]);
  let truncated = false;
  if (options.depth !== "item") {
    let frontier: ItemRef[] = [root];
    let level = 0;
    while (frontier.length && !truncated) {
      check();
      const nextFrontier: ItemRef[] = [];
      await pool(
        frontier.filter((r) => r.hasChildren),
        CONCURRENCY,
        async (parent) => {
          if (refs.length >= options.maxItems) {
            truncated = true;
            return;
          }
          // Ask for one more than the room left, so a full folder still reads as truncated.
          const kids = await source.children(parent.id, primary, options.maxItems - refs.length + 1);
          for (const kid of kids) {
            if (seen.has(kid.id)) continue;
            if (refs.length >= options.maxItems) {
              truncated = true;
              break;
            }
            seen.add(kid.id);
            refs.push(kid);
            nextFrontier.push(kid);
          }
          progress({ phase: "crawling", done: refs.length, total: 0, message: `Found ${refs.length} items…` });
        },
        signal,
      );
      level++;
      if (options.depth === "children" && level >= 1) break;
      frontier = nextFrontier;
    }
  }
  if (truncated) notices.push(`Stopped at ${options.maxItems} items. Raise the item limit or narrow the starting item to audit the rest.`);

  // 2. Read every item in every language.
  const items = new Map<string, Map<string, AuditItem | null>>();
  for (const ref of refs) items.set(ref.id, new Map());
  const batches = languages.flatMap((language) => chunk(refs.map((r) => r.id), BATCH_SIZE).map((ids) => ({ ids, language })));
  let readDone = 0;
  const total = refs.length * languages.length;
  await pool(
    batches,
    CONCURRENCY,
    async ({ ids, language }) => {
      try {
        const read = await source.readItems(ids, language);
        for (const id of ids) items.get(id)?.set(language, read.get(id) ?? null);
      } catch (error) {
        notices.push(`Could not read ${ids.length} item(s) in ${language}: ${(error as Error).message}`);
      }
      readDone += ids.length;
      progress({ phase: "reading", done: readDone, total, message: `Reading items (${readDone}/${total})…` });
    },
    signal,
  );

  // 3. Templates, with their base templates.
  const templates = new Map<string, TemplateDef | null>();
  let pending = [...new Set([...items.values()].flatMap((m) => [...m.values()]).map((i) => i?.templateId).filter((t): t is string => Boolean(t)))];
  while (pending.length) {
    check();
    const wave = pending.filter((t) => !templates.has(t));
    pending = [];
    await pool(
      wave,
      CONCURRENCY,
      async (tid) => {
        try {
          const def = await source.readTemplate(tid);
          templates.set(tid, def);
          for (const b of def?.baseTemplateIds ?? []) if (!templates.has(b)) pending.push(b);
        } catch (error) {
          templates.set(tid, null);
          notices.push(`Could not read template ${tid}: ${(error as Error).message}`);
        }
        progress({ phase: "templates", done: templates.size, total: templates.size + pending.length, message: `Reading templates (${templates.size})…` });
      },
      signal,
    );
    pending = [...new Set(pending)];
  }
  const templateFields = new Map<string, TemplateField[]>();
  for (const tid of templates.keys()) templateFields.set(tid, resolveTemplateFields(tid, templates));

  // 4. References: links, media, datasources, workflow states.
  const allRefs = new Set<string>();
  const externalUrls = new Set<string>();
  const ownIds = new Set(refs.map((r) => r.id));
  for (const byLanguage of items.values()) {
    for (const item of byLanguage.values()) {
      if (!item) continue;
      const found = collectReferences(item, templateFields.get(item.templateId) ?? [], options.checks.publishing);
      found.refs.forEach((r) => allRefs.add(r));
      found.external.forEach((u) => externalUrls.add(u));
    }
  }
  const references = new Map<string, ReferenceInfo>();
  // Items the crawl already read exist; only Alt / Final need a lookup for them, and those
  // are rarely audited items themselves, so they are looked up like everything else.
  const toLookup = [...allRefs];
  let refDone = 0;
  await pool(
    chunk(toLookup, BATCH_SIZE * 2),
    CONCURRENCY,
    async (group) => {
      try {
        const found = await source.lookup(group, primary, ["Alt", "Final"]);
        found.forEach((info, key) => references.set(key, info));
      } catch (error) {
        notices.push(`Could not check ${group.length} reference(s): ${(error as Error).message}`);
      }
      refDone += group.length;
      progress({ phase: "references", done: refDone, total: toLookup.length, message: `Checking references (${refDone}/${toLookup.length})…` });
    },
    signal,
  );
  for (const id of ownIds) if (!references.has(id)) references.set(id, { exists: true, fields: {} });

  // 5. External links.
  const external = new Map<string, ExternalLinkResult>();
  if (options.checks.links && options.checks.externalLinks && args.checkExternal && externalUrls.size) {
    let urls = [...externalUrls];
    if (urls.length > MAX_EXTERNAL_URLS) {
      notices.push(`Checked the first ${MAX_EXTERNAL_URLS} of ${urls.length} external URLs.`);
      urls = urls.slice(0, MAX_EXTERNAL_URLS);
    }
    let extDone = 0;
    await pool(
      chunk(urls, 20),
      2,
      async (group) => {
        try {
          for (const r of await args.checkExternal!(group)) external.set(r.url, r);
        } catch (error) {
          notices.push(`External link check failed: ${(error as Error).message}`);
        }
        extDone += group.length;
        progress({ phase: "external", done: extDone, total: urls.length, message: `Checking external links (${extDone}/${urls.length})…` });
      },
      signal,
    );
  }

  check();
  const issues = evaluate({
    options,
    items,
    templateFields,
    references,
    external,
    now: args.now ?? new Date(),
  });
  progress({ phase: "done", done: 1, total: 1, message: "Done" });

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    environment: args.environmentName,
    root: root.path || options.root,
    options,
    itemsScanned: refs.length,
    versionsScanned: [...items.values()].reduce((n, m) => n + [...m.values()].filter((i) => i && i.hasVersion !== false).length, 0),
    truncated,
    issues,
    notices,
  };
}
