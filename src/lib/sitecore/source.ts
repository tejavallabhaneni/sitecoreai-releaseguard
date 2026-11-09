import type { AuditItem, ItemRef, ReferenceInfo, SiteOption, TemplateDef } from "@/lib/types";

/**
 * Everything the audit needs from an environment. The live adapter talks to
 * the Authoring GraphQL API through the Marketplace SDK; the demo adapter
 * answers from memory. The engine only ever sees this contract.
 */
export interface AuditSource {
  readonly kind: "live" | "demo";
  /** Sites in the environment (for the scope picker). Empty when unknown. */
  listSites(): Promise<SiteOption[]>;
  /** Language codes defined in the environment. */
  listLanguages(): Promise<string[]>;
  /** One item by path or ID, as a light row. */
  resolve(pathOrId: string, language: string): Promise<ItemRef | null>;
  /** Direct children of an item. */
  children(id: string, language: string): Promise<ItemRef[]>;
  /** Full items (fields, standard fields, version, workflow) in one language. */
  readItems(ids: string[], language: string): Promise<Map<string, AuditItem | null>>;
  /** A template's own field definitions and base templates. */
  readTemplate(id: string): Promise<TemplateDef | null>;
  /** Look up IDs or paths; `extraFields` are read on each hit (e.g. "Alt", "Final"). */
  lookup(refs: string[], language: string, extraFields: string[]): Promise<Map<string, ReferenceInfo>>;
}
