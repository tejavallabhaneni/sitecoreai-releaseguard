/** Shared types for the ReleaseGuard audit. */

export interface Environment {
  /** Live Sitecore Context ID — what every SDK call names the environment by. */
  contextId: string;
  name: string;
  tenantName?: string;
}

export interface SiteOption {
  id: string;
  name: string;
  /** Item ID of the site's home page, when the Sites API reports one. */
  rootId?: string;
  /** Item path to start from, when known. */
  rootPath?: string;
  languages: string[];
}

/** A light row from a tree walk. */
export interface ItemRef {
  id: string;
  name: string;
  path: string;
  hasChildren: boolean;
  templateId?: string;
  templateName?: string;
}

/** Standard fields the audit reads on every item (raw values). */
export interface StandardFields {
  renderings?: string;
  finalRenderings?: string;
  neverPublish?: string;
  publish?: string;
  unpublish?: string;
  hideVersion?: string;
  validFrom?: string;
  validTo?: string;
  lock?: string;
  workflowState?: string;
  updated?: string;
  updatedBy?: string;
}

/** One item in one language, as the audit sees it. */
export interface AuditItem {
  id: string;
  name: string;
  path: string;
  templateId: string;
  templateName: string;
  language: string;
  /**
   * Whether a version exists in `language`. `null` means the endpoint could not
   * say, and the language rules treat the item as versioned.
   */
  hasVersion: boolean | null;
  version: number | null;
  /** Content fields (standard fields excluded), by field name. */
  fields: Record<string, string>;
  std: StandardFields;
  /** Workflow as reported by the endpoint, or null when it reports nothing. */
  workflow: { state: string; final: boolean } | null;
}

export interface TemplateField {
  id: string;
  name: string;
  type: string;
  section: string;
  required: boolean;
  /** Regex from the field's Validation field, if any. */
  validation?: string;
  validationText?: string;
  shared: boolean;
  unversioned: boolean;
}

export interface TemplateDef {
  id: string;
  name: string;
  path: string;
  baseTemplateIds: string[];
  /** Own fields only; resolve inheritance with `resolveTemplateFields`. */
  fields: TemplateField[];
}

/** What a reference lookup found for one ID or path. */
export interface ReferenceInfo {
  exists: boolean;
  id?: string;
  path?: string;
  name?: string;
  /** Requested extra field values, e.g. a media item's Alt, a workflow state's Final. */
  fields: Record<string, string>;
}

export type Severity = "error" | "warning" | "info";
export type Category = "required" | "links" | "images" | "languages" | "publishing";

export interface Issue {
  /** Stable key: rule + item + language + field + detail. */
  key: string;
  rule: RuleId;
  category: Category;
  severity: Severity;
  itemId: string;
  itemPath: string;
  itemName: string;
  language: string;
  field?: string;
  message: string;
  /** The offending value: a URL, an ID, a datasource. */
  target?: string;
  hint?: string;
}

export type RuleId =
  | "required-empty"
  | "required-configured"
  | "validation-regex"
  | "link-internal-broken"
  | "link-media-broken"
  | "link-external-broken"
  | "link-external-unverified"
  | "link-empty"
  | "link-insecure"
  | "reference-broken"
  | "image-alt-missing"
  | "image-media-broken"
  | "richtext-image-alt-missing"
  | "language-missing-version"
  | "language-untranslated-fields"
  | "language-no-primary-version"
  | "publish-workflow-not-final"
  | "publish-never-publish"
  | "publish-hidden-version"
  | "publish-scheduled"
  | "publish-expired"
  | "publish-locked"
  | "rendering-datasource-broken"
  | "rendering-definition-missing";

export interface AuditChecks {
  required: boolean;
  links: boolean;
  externalLinks: boolean;
  images: boolean;
  languages: boolean;
  publishing: boolean;
}

export interface AuditOptions {
  /** Item path or ID to start from. */
  root: string;
  /** How far below the root to go. */
  depth: "item" | "children" | "subtree";
  maxItems: number;
  primaryLanguage: string;
  /** Other languages every item is expected to exist in. */
  languages: string[];
  checks: AuditChecks;
  /** Field names that must be filled on page items (items with a layout), on top of template-required ones. */
  pageRequiredFields: string[];
}

export type AuditPhase =
  | "crawling"
  | "reading"
  | "templates"
  | "references"
  | "external"
  | "done";

export interface AuditProgress {
  phase: AuditPhase;
  done: number;
  total: number;
  message: string;
}

export interface ExternalLinkResult {
  url: string;
  ok: boolean;
  status: number | null;
  /** "broken" (definitely), "unverified" (blocked, timed out, refused), "ok". */
  verdict: "ok" | "broken" | "unverified";
  reason?: string;
}

export interface AuditResult {
  startedAt: string;
  finishedAt: string;
  environment: string;
  root: string;
  options: AuditOptions;
  itemsScanned: number;
  /** Item × language pairs that were read. */
  versionsScanned: number;
  truncated: boolean;
  issues: Issue[];
  /** Non-fatal problems the audit hit (a template it could not read, etc.). */
  notices: string[];
}
