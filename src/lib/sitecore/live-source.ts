import { LANGUAGES_ROOT } from "@/lib/config";
import { isGuid, normalizeId } from "@/lib/audit/parse";
import { REQUIRED_VALIDATOR_ID, STANDARD_TEMPLATE_ID, TEMPLATE_FIELD_TEMPLATE_ID } from "@/lib/sitecore/well-known";
import type { AuditItem, ItemRef, ReferenceInfo, SiteOption, StandardFields, TemplateDef, TemplateField } from "@/lib/types";
import { asRecord, authoringGraphQl, readString, sitesApi, type GraphQlResponse } from "./sdk";
import type { AuditSource } from "./source";

/** What `Item` exposes on this environment's Authoring schema. */
interface Capabilities {
  idField: "itemId" | "id";
  hasChildren: boolean;
  workflow: boolean;
  version: boolean;
  versions: boolean;
  childrenPaging: boolean;
}

const DEFAULTS: Capabilities = {
  idField: "itemId",
  hasChildren: true,
  workflow: false,
  version: false,
  versions: false,
  childrenPaging: false,
};

const PAGE_SIZE = 100;

/** Standard fields read by alias on every audited item. */
const STD_FIELDS: Record<keyof StandardFields, string> = {
  renderings: "__Renderings",
  finalRenderings: "__Final Renderings",
  neverPublish: "__Never publish",
  publish: "__Publish",
  unpublish: "__Unpublish",
  hideVersion: "__Hide version",
  validFrom: "__Valid from",
  validTo: "__Valid to",
  lock: "__Lock",
  workflowState: "__Workflow state",
  updated: "__Updated",
  updatedBy: "__Updated by",
};

/** Validation-rule fields on a template field item. Any one listing Required makes the field required. */
const VALIDATION_RULE_FIELDS = [
  "__Quick Action Bar Validation Rules",
  "__Validate Button Validation Rules",
  "__Validator Bar Validation Rules",
  "__Workflow Validation Rules",
];

const q = (value: string) => JSON.stringify(value);

function where(ref: string, language: string): string {
  const id = normalizeId(ref);
  return id ? `itemId: ${q(id)}, language: ${q(language)}` : `path: ${q(ref)}, language: ${q(language)}`;
}

function nodes(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const rec = asRecord(value);
  if (!rec) return [];
  if (Array.isArray(rec.nodes)) return rec.nodes;
  if (Array.isArray(rec.results)) return rec.results;
  return [];
}

function fieldValue(item: Record<string, unknown>, alias: string): string {
  return readString(asRecord(item[alias])?.value);
}

export class LiveSource implements AuditSource {
  readonly kind = "live" as const;
  private caps: Capabilities = DEFAULTS;
  private probe: Promise<void> | null = null;
  private fullTier: "rich" | "core" = "rich";

  constructor(private readonly contextId: string) {}

  private run(query: string): Promise<GraphQlResponse> {
    return authoringGraphQl(this.contextId, query);
  }

  private async ensureProbe(): Promise<void> {
    if (!this.probe) {
      this.probe = (async () => {
        try {
          const res = await this.run(`query RGProbe { itemType: __type(name: "Item") { fields { name args { name } } } }`);
          const fields = nodes(asRecord(res.data?.itemType)?.fields);
          if (!fields.length) return;
          const names = new Map<string, Set<string>>();
          for (const f of fields) {
            const rec = asRecord(f);
            const name = readString(rec?.name);
            if (!name) continue;
            names.set(name, new Set(nodes(rec?.args).map((a) => readString(asRecord(a)?.name))));
          }
          this.caps = {
            idField: names.has("itemId") ? "itemId" : "id",
            hasChildren: names.has("hasChildren"),
            workflow: names.has("workflow"),
            version: names.has("version"),
            versions: names.has("versions"),
            childrenPaging: Boolean(names.get("children")?.has("first") && names.get("children")?.has("after")),
          };
        } catch {
          // Introspection disabled: the conservative defaults stand.
        }
      })();
    }
    return this.probe;
  }

  private refSelection(): string {
    const c = this.caps;
    return [c.idField, "name", "path", c.hasChildren ? "hasChildren" : "", "template { templateId name }"]
      .filter(Boolean)
      .join("\n");
  }

  private toRef(raw: unknown): ItemRef | null {
    const rec = asRecord(raw);
    if (!rec) return null;
    const id = normalizeId(readString(rec[this.caps.idField], rec.itemId, rec.id));
    if (!id) return null;
    const template = asRecord(rec.template);
    return {
      id,
      name: readString(rec.name),
      path: readString(rec.path),
      hasChildren: this.caps.hasChildren ? rec.hasChildren === true : true,
      templateId: normalizeId(readString(template?.templateId, template?.id)) || undefined,
      templateName: readString(template?.name) || undefined,
    };
  }

  async listSites(): Promise<SiteOption[]> {
    try {
      const sites = await sitesApi("xmc.sites.listSites", this.contextId);
      return sites
        .map((raw): SiteOption | null => {
          const site = asRecord(raw);
          if (!site) return null;
          const host = asRecord(Array.isArray(site.hosts) ? site.hosts[0] : null);
          const rootId = normalizeId(readString(host?.homePageId, site.homePageId));
          const name = readString(site.displayName, site.name);
          if (!name) return null;
          return {
            id: readString(site.id) || name,
            name,
            rootId: rootId || undefined,
            rootPath: readString(site.rootPath) || undefined,
            languages: Array.isArray(site.languages) ? site.languages.filter((l): l is string => typeof l === "string") : [],
          };
        })
        .filter((s): s is SiteOption => s !== null)
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }

  async listLanguages(): Promise<string[]> {
    try {
      const langs = await sitesApi("xmc.sites.listLanguages", this.contextId);
      const codes = langs
        .map((raw) => readString(asRecord(raw)?.name, asRecord(raw)?.iso))
        .filter(Boolean);
      if (codes.length) return [...new Set(codes)];
    } catch {
      // Fall through to the item tree.
    }
    const root = await this.resolve(LANGUAGES_ROOT, "en");
    if (!root) return [];
    return (await this.children(root.id, "en")).map((c) => c.name).filter(Boolean);
  }

  async resolve(pathOrId: string, language: string): Promise<ItemRef | null> {
    await this.ensureProbe();
    const res = await this.run(`query RGResolve { item(where: { ${where(pathOrId, language)} }) {\n${this.refSelection()}\n} }`);
    if (!res.data && res.errors.length) throw new Error(res.errors.join(" "));
    return this.toRef(res.data?.item);
  }

  async children(id: string, language: string, limit = Infinity): Promise<ItemRef[]> {
    await this.ensureProbe();
    const out: ItemRef[] = [];
    const seenIds = new Set<string>();
    const seenCursors = new Set<string>();
    let cursor = "";
    for (let page = 0; page < 200 && out.length < limit; page++) {
      const args = this.caps.childrenPaging ? `(first: ${PAGE_SIZE}${cursor ? `, after: ${q(cursor)}` : ""})` : "";
      const pageInfo = this.caps.childrenPaging ? "pageInfo { hasNextPage endCursor }" : "";
      const res = await this.run(
        `query RGChildren { item(where: { ${where(id, language)} }) { children${args} { nodes {\n${this.refSelection()}\n} ${pageInfo} } } }`,
      );
      if (!res.data && res.errors.length) {
        if (this.caps.childrenPaging) {
          this.caps = { ...this.caps, childrenPaging: false };
          return this.children(id, language, limit);
        }
        throw new Error(res.errors.join(" "));
      }
      const children = asRecord(asRecord(res.data?.item)?.children);
      let added = 0;
      for (const node of nodes(children)) {
        const ref = this.toRef(node);
        if (!ref || seenIds.has(ref.id)) continue;
        seenIds.add(ref.id);
        out.push(ref);
        added++;
      }
      const info = asRecord(children?.pageInfo);
      if (!this.caps.childrenPaging || info?.hasNextPage !== true || added === 0) break;
      cursor = readString(info.endCursor);
      // A server that hands back the same cursor would otherwise page forever.
      if (!cursor || seenCursors.has(cursor)) break;
      seenCursors.add(cursor);
    }
    return out.slice(0, limit);
  }

  private fullSelection(): string {
    const c = this.caps;
    const rich = this.fullTier === "rich";
    const lines = [
      c.idField,
      "name",
      "path",
      "template { templateId name }",
      rich && c.version ? "version" : "",
      rich && c.versions ? "versions { version }" : "",
      rich && c.workflow ? "workflow { workflowState { displayName final } }" : "",
      "fields(ownFields: false, excludeStandardFields: true) { nodes { name value } }",
      ...Object.entries(STD_FIELDS).map(([alias, name]) => `std_${alias}: field(name: ${q(name)}) { value }`),
    ];
    return lines.filter(Boolean).join("\n");
  }

  private toAuditItem(raw: unknown, language: string): AuditItem | null {
    const rec = asRecord(raw);
    const ref = this.toRef(raw);
    if (!rec || !ref) return null;
    const fields: Record<string, string> = {};
    for (const node of nodes(rec.fields)) {
      const f = asRecord(node);
      const name = readString(f?.name);
      if (name) fields[name] = typeof f?.value === "string" ? f.value : "";
    }
    const std: StandardFields = {};
    for (const alias of Object.keys(STD_FIELDS) as (keyof StandardFields)[]) {
      const value = fieldValue(rec, `std_${alias}`);
      if (value) std[alias] = value;
    }
    let version: number | null = typeof rec.version === "number" ? rec.version : null;
    let hasVersion: boolean | null = null;
    if (Array.isArray(rec.versions)) {
      hasVersion = rec.versions.length > 0;
      if (version === null && rec.versions.length) version = rec.versions.length;
    } else if (version !== null) {
      hasVersion = version > 0;
    }
    const state = asRecord(asRecord(rec.workflow)?.workflowState);
    return {
      id: ref.id,
      name: ref.name,
      path: ref.path,
      templateId: ref.templateId ?? "",
      templateName: ref.templateName ?? "",
      language,
      hasVersion,
      version,
      fields,
      std,
      workflow: state ? { state: readString(state.displayName), final: state.final === true } : null,
    };
  }

  async readItems(ids: string[], language: string): Promise<Map<string, AuditItem | null>> {
    await this.ensureProbe();
    const out = new Map<string, AuditItem | null>();
    if (!ids.length) return out;
    const selection = this.fullSelection();
    const body = ids
      .map((id, i) => `i${i}: item(where: { ${where(id, language)} }) {\n${selection}\n}`)
      .join("\n");
    const res = await this.run(`query RGItems {\n${body}\n}`);
    if (!res.data && res.errors.length) {
      if (this.fullTier === "rich") {
        this.fullTier = "core";
        return this.readItems(ids, language);
      }
      throw new Error(res.errors.join(" "));
    }
    ids.forEach((id, i) => out.set(id, this.toAuditItem(res.data?.[`i${i}`], language)));
    return out;
  }

  async readTemplate(id: string): Promise<TemplateDef | null> {
    await this.ensureProbe();
    const templateId = normalizeId(id);
    if (!templateId || templateId === STANDARD_TEMPLATE_ID) return null;
    const idf = this.caps.idField;
    const fieldSel = [
      idf,
      "name",
      "template { templateId }",
      `type: field(name: "Type") { value }`,
      `shared: field(name: "Shared") { value }`,
      `unversioned: field(name: "Unversioned") { value }`,
      `validation: field(name: "Validation") { value }`,
      `validationText: field(name: "ValidationText") { value }`,
      ...VALIDATION_RULE_FIELDS.map((name, i) => `rules${i}: field(name: ${q(name)}) { value }`),
    ].join("\n");
    const res = await this.run(`query RGTemplate {
  item(where: { itemId: ${q(templateId)}, language: "en" }) {
    ${idf} name path
    baseTemplate: field(name: "__Base template") { value }
    children { nodes { ${idf} name template { templateId }
      children { nodes {\n${fieldSel}\n} }
    } }
  }
}`);
    if (!res.data && res.errors.length) throw new Error(res.errors.join(" "));
    const item = asRecord(res.data?.item);
    if (!item) return null;
    const fields: TemplateField[] = [];
    for (const sectionRaw of nodes(item.children)) {
      const section = asRecord(sectionRaw);
      if (!section || readString(section.name) === "__Standard Values") continue;
      for (const fieldRaw of nodes(section.children)) {
        const f = asRecord(fieldRaw);
        if (!f) continue;
        const tid = normalizeId(readString(asRecord(f.template)?.templateId));
        if (tid && tid !== TEMPLATE_FIELD_TEMPLATE_ID) continue;
        const rules = VALIDATION_RULE_FIELDS.map((_, i) => fieldValue(f, `rules${i}`)).join("|");
        fields.push({
          id: normalizeId(readString(f[idf], f.itemId, f.id)),
          name: readString(f.name),
          type: fieldValue(f, "type"),
          section: readString(section.name),
          required: rules.toUpperCase().includes(REQUIRED_VALIDATOR_ID),
          validation: fieldValue(f, "validation") || undefined,
          validationText: fieldValue(f, "validationText") || undefined,
          shared: fieldValue(f, "shared") === "1",
          unversioned: fieldValue(f, "unversioned") === "1",
        });
      }
    }
    return {
      id: templateId,
      name: readString(item.name),
      path: readString(item.path),
      baseTemplateIds: fieldValue(item, "baseTemplate")
        .split("|")
        .map(normalizeId)
        .filter((b) => b && b !== STANDARD_TEMPLATE_ID),
      fields,
    };
  }

  async lookup(refs: string[], language: string, extraFields: string[]): Promise<Map<string, ReferenceInfo>> {
    await this.ensureProbe();
    const out = new Map<string, ReferenceInfo>();
    const valid = refs.filter((r) => isGuid(r) || r.startsWith("/sitecore"));
    for (const r of refs) if (!valid.includes(r)) out.set(r, { exists: false, fields: {} });
    if (!valid.length) return out;
    const extras = extraFields.map((name, i) => `x${i}: field(name: ${q(name)}) { value }`).join("\n");
    const body = valid
      .map((ref, i) => `r${i}: item(where: { ${where(ref, language)} }) { ${this.caps.idField} name path\n${extras} }`)
      .join("\n");
    const res = await this.run(`query RGLookup {\n${body}\n}`);
    if (!res.data && res.errors.length) {
      // One malformed path can fail the whole batch: fall back to one at a time.
      if (valid.length > 1) {
        for (const ref of valid) {
          const one = await this.lookup([ref], language, extraFields);
          out.set(ref, one.get(ref) ?? { exists: false, fields: {} });
        }
        return out;
      }
      out.set(valid[0], { exists: false, fields: {} });
      return out;
    }
    valid.forEach((ref, i) => {
      const rec = asRecord(res.data?.[`r${i}`]);
      if (!rec) {
        out.set(ref, { exists: false, fields: {} });
        return;
      }
      const fields: Record<string, string> = {};
      extraFields.forEach((name, j) => {
        fields[name] = fieldValue(rec, `x${j}`);
      });
      out.set(ref, {
        exists: true,
        id: normalizeId(readString(rec[this.caps.idField], rec.itemId, rec.id)),
        name: readString(rec.name),
        path: readString(rec.path),
        fields,
      });
    });
    return out;
  }
}
