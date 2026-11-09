/**
 * The checks. Pure: given what was read, produce issues. No I/O here, so every
 * rule is unit-testable against hand-built items.
 */
import type {
  AuditItem,
  AuditOptions,
  Category,
  ExternalLinkResult,
  Issue,
  ReferenceInfo,
  RuleId,
  Severity,
  TemplateField,
} from "@/lib/types";
import {
  extractGuids,
  fieldKind,
  hasLayout,
  isBlank,
  isChecked,
  isGuid,
  lockOwner,
  normalizeId,
  parseGeneralLink,
  parseImage,
  parseRenderings,
  parseRichText,
  parseSitecoreDate,
  resolveDatasource,
  sniffKind,
} from "./parse";

export const RULES: Record<RuleId, { category: Category; title: string }> = {
  "required-empty": { category: "required", title: "Required field is empty" },
  "required-configured": { category: "required", title: "Page field is empty" },
  "validation-regex": { category: "required", title: "Field fails its validation pattern" },
  "link-internal-broken": { category: "links", title: "Internal link points to a missing item" },
  "link-media-broken": { category: "links", title: "Media link points to a missing item" },
  "link-external-broken": { category: "links", title: "External link is broken" },
  "link-external-unverified": { category: "links", title: "External link could not be verified" },
  "link-empty": { category: "links", title: "Link has no destination" },
  "link-insecure": { category: "links", title: "Link uses http://" },
  "reference-broken": { category: "links", title: "Reference to a missing item" },
  "image-alt-missing": { category: "images", title: "Image has no description (alt text)" },
  "image-media-broken": { category: "images", title: "Image points to a missing media item" },
  "richtext-image-alt-missing": { category: "images", title: "Rich text image has no alt attribute" },
  "language-missing-version": { category: "languages", title: "Missing language version" },
  "language-untranslated-fields": { category: "languages", title: "Fields not translated" },
  "language-no-primary-version": { category: "languages", title: "No version in the primary language" },
  "publish-workflow-not-final": { category: "publishing", title: "Workflow state is not final" },
  "publish-never-publish": { category: "publishing", title: "Item is set to never publish" },
  "publish-hidden-version": { category: "publishing", title: "Version is hidden" },
  "publish-scheduled": { category: "publishing", title: "Publishing is scheduled for later" },
  "publish-expired": { category: "publishing", title: "Item is past its unpublish date" },
  "publish-locked": { category: "publishing", title: "Item is locked for editing" },
  "rendering-datasource-broken": { category: "publishing", title: "Component datasource is missing" },
  "rendering-definition-missing": { category: "publishing", title: "Component rendering is missing" },
};

export const CATEGORY_LABELS: Record<Category, string> = {
  required: "Required content",
  links: "Links & references",
  images: "Image descriptions",
  languages: "Languages",
  publishing: "Publishing",
};

/** Everything the rules read. */
export interface RuleContext {
  options: AuditOptions;
  /** item ID → language → item (null: the read came back empty). */
  items: Map<string, Map<string, AuditItem | null>>;
  /** template ID → resolved fields, inherited ones included. */
  templateFields: Map<string, TemplateField[]>;
  /** ID or path → what the lookup found. */
  references: Map<string, ReferenceInfo>;
  external: Map<string, ExternalLinkResult>;
  now: Date;
}

class IssueSink {
  private byKey = new Map<string, Issue>();

  add(
    rule: RuleId,
    severity: Severity,
    item: Pick<AuditItem, "id" | "path" | "name" | "language">,
    message: string,
    extra: { field?: string; target?: string; hint?: string } = {},
  ): void {
    const key = [rule, item.id, item.language, extra.field ?? "", extra.target ?? ""].join("|");
    if (this.byKey.has(key)) return;
    this.byKey.set(key, {
      key,
      rule,
      category: RULES[rule].category,
      severity,
      itemId: item.id,
      itemPath: item.path,
      itemName: item.name,
      language: item.language,
      message,
      ...extra,
    });
  }

  list(): Issue[] {
    return [...this.byKey.values()];
  }
}

/** Every reference the rules will want answered, so the engine can look them up in bulk. */
export function collectReferences(
  item: AuditItem,
  fields: TemplateField[],
  needWorkflowLookup: boolean,
): { refs: Set<string>; external: Set<string> } {
  const refs = new Set<string>();
  const external = new Set<string>();
  const types = new Map(fields.map((f) => [f.name, f.type]));
  for (const [name, value] of Object.entries(item.fields)) {
    if (!value.trim()) continue;
    const kind = kindOf(types.get(name), value);
    if (kind === "link") {
      const link = parseGeneralLink(value);
      if (link?.id) refs.add(link.id);
      if (link && link.linktype === "external" && /^https?:\/\//i.test(link.url)) external.add(link.url);
    } else if (kind === "image") {
      const image = parseImage(value);
      if (image) refs.add(image.mediaId);
    } else if (kind === "richtext") {
      const rt = parseRichText(value);
      for (const l of rt.links) {
        if (l.itemId) refs.add(l.itemId);
        if (l.mediaId) refs.add(l.mediaId);
        if (l.external) external.add(l.external);
      }
    } else if (kind === "reference") {
      for (const id of extractGuids(value)) refs.add(id);
    }
  }
  for (const xml of [item.std.renderings, item.std.finalRenderings]) {
    for (const r of parseRenderings(xml ?? "")) {
      if (r.renderingId) refs.add(r.renderingId);
      const ds = resolveDatasource(r.datasource, item.path);
      if (ds) refs.add(ds);
    }
  }
  if (needWorkflowLookup && !item.workflow && isGuid(item.std.workflowState)) {
    refs.add(normalizeId(item.std.workflowState));
  }
  return { refs, external };
}

function kindOf(type: string | undefined, value: string) {
  if (type) {
    const kind = fieldKind(type);
    if (kind !== "other" && kind !== "text") return kind;
    if (kind === "text") return "text";
  }
  return sniffKind(value);
}

function missing(ctx: RuleContext, ref: string): boolean {
  const info = ctx.references.get(ref);
  // Not looked up (should not happen) is not evidence of a broken link.
  return info ? !info.exists : false;
}


export function evaluate(ctx: RuleContext): Issue[] {
  const sink = new IssueSink();
  const { options } = ctx;
  const primary = options.primaryLanguage;

  for (const [, byLanguage] of ctx.items) {
    const base = byLanguage.get(primary) ?? [...byLanguage.values()].find(Boolean) ?? null;
    if (!base) continue;
    const fields = ctx.templateFields.get(base.templateId) ?? [];
    const isPage = hasLayout(base.std);

    for (const [language, item] of byLanguage) {
      if (!item) continue;
      const versioned = item.hasVersion !== false;
      if (versioned) {
        if (options.checks.required) requiredRules(ctx, sink, item, fields, isPage);
        if (options.checks.links || options.checks.images) contentRules(ctx, sink, item, fields);
        if (options.checks.publishing) publishingRules(ctx, sink, item, language === primary);
      }
    }

    if (options.checks.languages) languageRules(ctx, sink, base, byLanguage, fields, isPage);
  }

  return sink.list().sort(compareIssues);
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function compareIssues(a: Issue, b: Issue): number {
  return (
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    a.itemPath.localeCompare(b.itemPath) ||
    a.language.localeCompare(b.language) ||
    a.rule.localeCompare(b.rule)
  );
}

function requiredRules(ctx: RuleContext, sink: IssueSink, item: AuditItem, fields: TemplateField[], isPage: boolean) {
  const flagged = new Set<string>();
  for (const field of fields) {
    const value = item.fields[field.name] ?? "";
    if (field.required && isBlank(value)) {
      flagged.add(field.name.toLowerCase());
      sink.add("required-empty", "error", item, `"${field.name}" is required but empty.`, {
        field: field.name,
        hint: "The template marks this field Required. Fill it in before publishing.",
      });
    }
    if (field.validation && !isBlank(value)) {
      let re: RegExp | null = null;
      try {
        re = new RegExp(field.validation);
      } catch {
        re = null;
      }
      if (re && !re.test(value)) {
        sink.add("validation-regex", "warning", item, field.validationText || `"${field.name}" does not match ${field.validation}.`, {
          field: field.name,
          target: value.slice(0, 120),
        });
      }
    }
  }
  if (!isPage) return;
  const templateNames = new Set(fields.map((f) => f.name.toLowerCase()));
  for (const name of ctx.options.pageRequiredFields) {
    const key = name.trim().toLowerCase();
    if (!key || flagged.has(key)) continue;
    const actual = Object.keys(item.fields).find((f) => f.toLowerCase() === key);
    // Only fields this page actually has: a template without "MetaDescription" is not missing one.
    if (!actual && !templateNames.has(key)) continue;
    if (isBlank(actual ? item.fields[actual] : "")) {
      sink.add("required-configured", "warning", item, `Page field "${actual ?? name}" is empty.`, {
        field: actual ?? name,
        hint: "Listed under Page fields that must be filled in this audit's settings.",
      });
    }
  }
}

function checkExternal(ctx: RuleContext, sink: IssueSink, item: AuditItem, field: string, url: string) {
  if (/^http:\/\//i.test(url)) {
    sink.add("link-insecure", "info", item, `Link uses insecure http://.`, { field, target: url });
  }
  if (!ctx.options.checks.externalLinks) return;
  const result = ctx.external.get(url);
  if (!result) return;
  if (result.verdict === "broken") {
    sink.add("link-external-broken", "error", item, `External link returns ${result.status ?? result.reason ?? "an error"}.`, {
      field,
      target: url,
    });
  } else if (result.verdict === "unverified") {
    sink.add("link-external-unverified", "info", item, `External link could not be verified (${result.reason ?? result.status ?? "no answer"}).`, {
      field,
      target: url,
    });
  }
}

function contentRules(ctx: RuleContext, sink: IssueSink, item: AuditItem, fields: TemplateField[]) {
  const types = new Map(fields.map((f) => [f.name, f.type]));
  const { links, images } = ctx.options.checks;
  for (const [name, value] of Object.entries(item.fields)) {
    if (!value.trim()) continue;
    const kind = kindOf(types.get(name), value);

    if (kind === "link" && links) {
      const link = parseGeneralLink(value);
      if (!link || !link.linktype) continue;
      if (link.linktype === "internal") {
        if (!link.id) sink.add("link-empty", "warning", item, `Internal link "${name}" has no target item.`, { field: name });
        else if (missing(ctx, link.id))
          sink.add("link-internal-broken", "error", item, `"${name}" links to an item that no longer exists.`, { field: name, target: link.id });
      } else if (link.linktype === "media") {
        if (!link.id) sink.add("link-empty", "warning", item, `Media link "${name}" has no media item.`, { field: name });
        else if (missing(ctx, link.id))
          sink.add("link-media-broken", "error", item, `"${name}" links to a media item that no longer exists.`, { field: name, target: link.id });
      } else if (link.linktype === "external") {
        if (!link.url.trim()) sink.add("link-empty", "warning", item, `External link "${name}" has no URL.`, { field: name });
        else checkExternal(ctx, sink, item, name, link.url.trim());
      } else if (link.linktype === "mailto" && !/^mailto:.+@/i.test(link.url)) {
        sink.add("link-empty", "warning", item, `Mail link "${name}" has no address.`, { field: name, target: link.url });
      }
    } else if (kind === "image") {
      const image = parseImage(value);
      if (!image || !images) continue;
      const media = ctx.references.get(image.mediaId);
      if (missing(ctx, image.mediaId)) {
        sink.add("image-media-broken", "error", item, `"${name}" points to a media item that no longer exists.`, {
          field: name,
          target: image.mediaId,
        });
      } else if (media && isBlank(image.alt) && isBlank(media.fields.Alt)) {
        // `media` undefined: the lookup failed, so the media item's Alt is unknown (not evidence).
        sink.add("image-alt-missing", "error", item, `"${name}" has no alt text on the field or on its media item.`, {
          field: name,
          target: media?.path ?? image.mediaId,
          hint: "Add Alt text on the media item (or on this field) so screen readers can describe the image.",
        });
      }
    } else if (kind === "richtext") {
      const rt = parseRichText(value);
      if (links) {
        for (const l of rt.links) {
          if (l.itemId) {
            if (missing(ctx, l.itemId))
              sink.add("link-internal-broken", "error", item, `"${name}" contains a link to an item that no longer exists.`, {
                field: name,
                target: l.itemId,
              });
          } else if (l.mediaId) {
            if (missing(ctx, l.mediaId))
              sink.add("link-media-broken", "error", item, `"${name}" contains a link to a media item that no longer exists.`, {
                field: name,
                target: l.mediaId,
              });
          } else if (l.external) {
            checkExternal(ctx, sink, item, name, l.external);
          } else if (!l.href || l.href === "#" || /^javascript:/i.test(l.href)) {
            sink.add("link-empty", "warning", item, `"${name}" contains a link with no destination.`, {
              field: name,
              target: l.href || "(empty href)",
            });
          }
        }
      }
      if (images) {
        for (const img of rt.images) {
          if (img.mediaId && missing(ctx, img.mediaId)) {
            sink.add("image-media-broken", "error", item, `"${name}" embeds a media item that no longer exists.`, {
              field: name,
              target: img.mediaId,
            });
          } else if (img.alt === null) {
            sink.add("richtext-image-alt-missing", "error", item, `"${name}" has an image with no alt attribute.`, {
              field: name,
              target: img.src.slice(0, 160),
              hint: 'Add alt text, or alt="" if the image is purely decorative.',
            });
          }
        }
      }
    } else if (kind === "reference" && links) {
      for (const id of extractGuids(value)) {
        if (missing(ctx, id))
          sink.add("reference-broken", "error", item, `"${name}" references an item that no longer exists.`, { field: name, target: id });
      }
    }
  }
}

function publishingRules(ctx: RuleContext, sink: IssueSink, item: AuditItem, isPrimary: boolean) {
  const { std } = item;
  const now = ctx.now;

  if (item.workflow) {
    if (!item.workflow.final) {
      sink.add("publish-workflow-not-final", "error", item, `Workflow state "${item.workflow.state || "unknown"}" is not final, so this version will not publish.`, {
        target: item.workflow.state,
        hint: "Approve the item through workflow before the release.",
      });
    }
  } else if (isGuid(std.workflowState)) {
    const state = ctx.references.get(normalizeId(std.workflowState));
    if (state?.exists && state.fields.Final !== "1") {
      sink.add("publish-workflow-not-final", "error", item, `Workflow state "${state.name || "unknown"}" is not final, so this version will not publish.`, {
        target: state.name,
        hint: "Approve the item through workflow before the release.",
      });
    }
  }

  if (isPrimary && isChecked(std.neverPublish)) {
    sink.add("publish-never-publish", "warning", item, `"Never publish" is ticked: this item (and its subitems) will not publish.`);
  }
  if (isChecked(std.hideVersion)) {
    sink.add("publish-hidden-version", "warning", item, `"Hide version" is ticked: this version will not publish.`);
  }
  // __Publish / __Unpublish are shared (item-level), like __Never publish: report them once, on the
  // primary language. __Valid from / __Valid to are per version.
  const starts: [string, string | undefined][] = [["Valid from", std.validFrom]];
  const ends: [string, string | undefined][] = [["Valid to", std.validTo]];
  if (isPrimary) {
    starts.unshift(["Publish", std.publish]);
    ends.unshift(["Unpublish", std.unpublish]);
  }
  for (const [label, raw] of starts) {
    const date = parseSitecoreDate(raw);
    if (date && date > now) {
      sink.add("publish-scheduled", "info", item, `"${label}" is ${date.toISOString().slice(0, 16).replace("T", " ")} UTC — it will not go live before then.`, {
        target: date.toISOString(),
      });
    }
  }
  for (const [label, raw] of ends) {
    const date = parseSitecoreDate(raw);
    if (date && date <= now) {
      sink.add("publish-expired", "warning", item, `"${label}" was ${date.toISOString().slice(0, 16).replace("T", " ")} UTC — this will be removed on publish.`, {
        target: date.toISOString(),
      });
    }
  }
  const owner = lockOwner(std.lock);
  if (owner) {
    sink.add("publish-locked", "warning", item, `Locked by ${owner}: their unsaved edits may not be in this release.`, { target: owner });
  }

  const seen = new Set<string>();
  const layouts = isPrimary ? [std.renderings, std.finalRenderings] : [std.finalRenderings];
  for (const xml of layouts) {
    for (const r of parseRenderings(xml ?? "")) {
      if (r.renderingId && !seen.has(r.renderingId) && missing(ctx, r.renderingId)) {
        seen.add(r.renderingId);
        sink.add("rendering-definition-missing", "error", item, `A component on this page uses a rendering that no longer exists.`, {
          target: r.renderingId,
          field: r.placeholder ? `placeholder ${r.placeholder}` : undefined,
        });
      }
      const ds = resolveDatasource(r.datasource, item.path);
      if (ds && !seen.has(ds) && missing(ctx, ds)) {
        seen.add(ds);
        sink.add("rendering-datasource-broken", "error", item, `A component's datasource is missing: it will render empty or fail.`, {
          target: r.datasource,
          field: r.placeholder ? `placeholder ${r.placeholder}` : undefined,
        });
      }
    }
  }
}

function languageRules(
  ctx: RuleContext,
  sink: IssueSink,
  base: AuditItem,
  byLanguage: Map<string, AuditItem | null>,
  fields: TemplateField[],
  isPage: boolean,
) {
  const primary = ctx.options.primaryLanguage;
  const primaryItem = byLanguage.get(primary) ?? null;
  // A null read means "no version" for the other languages below; treat the primary the same way
  // (`base` then came from another language, so the item itself exists).
  if (byLanguage.get(primary) === null || primaryItem?.hasVersion === false) {
    const target = primaryItem ?? { id: base.id, path: base.path, name: base.name, language: primary };
    sink.add("language-no-primary-version", "warning", target, `No version in the primary language (${primary}).`);
    return;
  }
  const sharedish = new Set(fields.filter((f) => f.shared || f.unversioned).map((f) => f.name));
  for (const language of ctx.options.languages) {
    if (language === primary) continue;
    const item = byLanguage.get(language);
    const target = { id: base.id, path: base.path, name: base.name, language };
    if (item === undefined) continue;
    if (item === null || item.hasVersion === false) {
      sink.add(
        "language-missing-version",
        isPage ? "error" : "warning",
        target,
        isPage ? `This page has no ${language} version: it will not be available in ${language}.` : `No ${language} version.`,
        { hint: `Add a ${language} version and translate it.` },
      );
      continue;
    }
    if (!primaryItem) continue;
    const untranslated = Object.entries(primaryItem.fields)
      .filter(([name, value]) => !sharedish.has(name) && !isBlank(value) && isBlank(item.fields[name]))
      .map(([name]) => name);
    if (untranslated.length) {
      sink.add(
        "language-untranslated-fields",
        "warning",
        target,
        `${untranslated.length} field${untranslated.length === 1 ? " is" : "s are"} filled in ${primary} but empty in ${language}: ${untranslated.slice(0, 6).join(", ")}${untranslated.length > 6 ? "…" : ""}.`,
        { target: untranslated.join(", ") },
      );
    }
  }
}
