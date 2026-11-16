"use client";

import { FolderTree, Play, Square } from "lucide-react";
import { useId } from "react";
import { MAX_ITEMS_LIMIT } from "@/lib/config";
import { parseTargets } from "@/lib/audit/targets";
import type { AuditChecks, AuditOptions, Environment, SiteOption } from "@/lib/types";
import { Button, Checkbox, Chip, Input, Label, Select } from "./ui";

export type ScopeMode = "root" | "list";

const CHECKS: { key: keyof AuditChecks; label: string; description: string }[] = [
  { key: "required", label: "Required content", description: "Template-required fields, validation patterns, page fields" },
  { key: "links", label: "Links & references", description: "Internal links, media links, droplists, empty links" },
  { key: "externalLinks", label: "Check external URLs", description: "Requests each http(s) link from the server" },
  { key: "images", label: "Image descriptions", description: "Alt text on image fields and rich text images" },
  { key: "languages", label: "Languages", description: "Missing versions and untranslated fields" },
  { key: "publishing", label: "Publishing", description: "Workflow, restrictions, locks, broken components" },
];

export interface SettingsPanelProps {
  environments: Environment[];
  environmentId: string;
  onEnvironmentChange: (id: string) => void;
  sites: SiteOption[];
  siteId: string;
  onSiteChange: (id: string) => void;
  availableLanguages: string[];
  options: AuditOptions;
  onChange: (options: AuditOptions) => void;
  running: boolean;
  onRun: () => void;
  onCancel: () => void;
  loadingScope: boolean;
  /** Audit one starting item, or a list of specific items. */
  scopeMode: ScopeMode;
  onScopeModeChange: (mode: ScopeMode) => void;
  /** The "Specific items" list, one path or ID per line. */
  targetsText: string;
  onTargetsTextChange: (text: string) => void;
  treeOpen: boolean;
  onBrowseTree: () => void;
}

export function SettingsPanel(props: SettingsPanelProps) {
  const { options, onChange } = props;
  const ids = { env: useId(), site: useId(), root: useId(), depth: useId(), max: useId(), lang: useId(), fields: useId(), list: useId() };
  const set = <K extends keyof AuditOptions>(key: K, value: AuditOptions[K]) => onChange({ ...options, [key]: value });
  const otherLanguages = props.availableLanguages.filter((l) => l !== options.primaryLanguage);
  // "Check external URLs" is a sub-option of Links, not a check on its own.
  const { externalLinks: _sub, ...mainChecks } = options.checks;
  void _sub;
  const targets = parseTargets(props.targetsText);
  const hasScope = props.scopeMode === "list" ? targets.length > 0 : Boolean(options.root.trim());
  const canRun = hasScope && Object.values(mainChecks).some(Boolean);
  const below = targets.filter((t) => t.depth !== "item").length;

  return (
    <div className="flex flex-col gap-5 p-4">
      <div>
        <Label htmlFor={ids.env}>Environment</Label>
        <Select
          id={ids.env}
          value={props.environmentId}
          disabled={props.running}
          onChange={(e) => props.onEnvironmentChange(e.target.value)}
        >
          {props.environments.map((env) => (
            <option key={env.contextId} value={env.contextId}>
              {env.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-3">
        <div>
          <Label htmlFor={ids.site} hint="Picks the site's root, so pages and their Data folder are both audited.">
            Site
          </Label>
          <Select
            id={ids.site}
            value={props.siteId}
            disabled={props.running || props.loadingScope}
            onChange={(e) => props.onSiteChange(e.target.value)}
          >
            <option value="">{props.loadingScope ? "Loading sites…" : props.sites.length ? "Custom path…" : "No sites found — use a path"}</option>
            {props.sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </Select>
        </div>
        <fieldset disabled={props.running} aria-label="What to audit" className="flex flex-wrap gap-2">
          <Chip active={props.scopeMode === "root"} onClick={() => props.onScopeModeChange("root")}>
            A starting item
          </Chip>
          <Chip active={props.scopeMode === "list"} onClick={() => props.onScopeModeChange("list")}>
            Specific items
          </Chip>
        </fieldset>
        {props.scopeMode === "root" ? (
          <div>
            <Label htmlFor={ids.root}>Start from (path or item ID)</Label>
            <Input
              id={ids.root}
              value={options.root}
              disabled={props.running}
              spellCheck={false}
              placeholder="/sitecore/content/…"
              className="font-mono text-[13px]"
              onChange={(e) => set("root", e.target.value)}
            />
          </div>
        ) : (
          <div>
            <Label
              htmlFor={ids.list}
              hint={
                <>
                  One path or item ID per line. End a line with <code className="font-mono">{"/*"}</code> to add its children, or{" "}
                  <code className="font-mono">{"/**"}</code> for everything below it.
                </>
              }
            >
              Items to audit
            </Label>
            <textarea
              id={ids.list}
              value={props.targetsText}
              disabled={props.running}
              spellCheck={false}
              rows={6}
              placeholder={"/sitecore/content/Site/Home/About\n/sitecore/content/Site/Home/News/*\n/sitecore/content/Site/Home/Products/**"}
              className="w-full resize-y rounded-[5px] border border-control bg-surface px-2.5 py-2 font-mono text-[12px] leading-5 text-ink placeholder:text-subtle focus:border-info focus:outline-none"
              onChange={(e) => props.onTargetsTextChange(e.target.value)}
            />
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="text-xs text-muted">
                {targets.length
                  ? `${targets.length} item${targets.length === 1 ? "" : "s"}${below ? `, ${below} with items below` : ""}`
                  : "No items yet"}
              </span>
              <Button size="sm" variant={props.treeOpen ? "ghost" : "secondary"} disabled={props.running} onClick={props.onBrowseTree}>
                <FolderTree className="size-3.5" /> {props.treeOpen ? "Tree is open" : "Browse content tree"}
              </Button>
            </div>
          </div>
        )}
        <div className={props.scopeMode === "root" ? "grid grid-cols-[1fr_7rem] gap-2" : "grid grid-cols-[7rem] gap-2"}>
          {props.scopeMode === "root" ? (
            <div>
              <Label htmlFor={ids.depth}>Scope</Label>
              <Select
                id={ids.depth}
                value={options.depth}
                disabled={props.running}
                onChange={(e) => set("depth", e.target.value as AuditOptions["depth"])}
              >
                <option value="subtree">Item and all descendants</option>
                <option value="children">Item and its children</option>
                <option value="item">This item only</option>
              </Select>
            </div>
          ) : null}
          <div>
            <Label htmlFor={ids.max}>Item limit</Label>
            <Input
              id={ids.max}
              type="number"
              min={1}
              max={MAX_ITEMS_LIMIT}
              value={options.maxItems}
              disabled={props.running}
              onChange={(e) => set("maxItems", Math.min(MAX_ITEMS_LIMIT, Math.max(1, Number(e.target.value) || 1)))}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div>
          <Label htmlFor={ids.lang}>Primary language</Label>
          <Select
            id={ids.lang}
            value={options.primaryLanguage}
            disabled={props.running}
            onChange={(e) =>
              onChange({
                ...options,
                primaryLanguage: e.target.value,
                languages: options.languages.filter((l) => l !== e.target.value),
              })
            }
          >
            {[...new Set([options.primaryLanguage, ...props.availableLanguages])].map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </Select>
        </div>
        <fieldset disabled={props.running}>
          <legend className="mb-1.5 text-[13px] font-bold text-navy">Languages every item should have</legend>
          {otherLanguages.length ? (
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {otherLanguages.map((l) => (
                <Checkbox
                  key={l}
                  label={l}
                  checked={options.languages.includes(l)}
                  onChange={(on) => set("languages", on ? [...options.languages, l] : options.languages.filter((x) => x !== l))}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted">This environment has no other languages.</p>
          )}
        </fieldset>
      </div>

      <fieldset disabled={props.running} className="flex flex-col gap-2.5">
        <legend className="mb-1.5 text-[13px] font-bold text-navy">Checks</legend>
        {CHECKS.map((check) => (
          <div key={check.key} className={check.key === "externalLinks" ? "pl-6" : undefined}>
            <Checkbox
              label={check.label}
              description={check.description}
              checked={options.checks[check.key]}
              disabled={check.key === "externalLinks" && !options.checks.links}
              onChange={(on) => set("checks", { ...options.checks, [check.key]: on })}
            />
          </div>
        ))}
      </fieldset>

      <div>
        <Label htmlFor={ids.fields} hint="Comma-separated. Checked on items that have a layout, on top of template-required fields.">
          Page fields that must be filled
        </Label>
        <Input
          id={ids.fields}
          value={options.pageRequiredFields.join(", ")}
          disabled={props.running}
          onChange={(e) =>
            set(
              "pageRequiredFields",
              e.target.value.split(",").map((s) => s.trimStart()),
            )
          }
          onBlur={() => set("pageRequiredFields", options.pageRequiredFields.map((s) => s.trim()).filter(Boolean))}
        />
      </div>

      <div className="sticky bottom-0 -mx-4 -mb-4 border-t border-line bg-surface p-4">
        {props.running ? (
          <Button variant="danger" className="w-full" onClick={props.onCancel}>
            <Square className="size-3.5" /> Cancel audit
          </Button>
        ) : (
          <Button variant="primary" className="w-full" disabled={!canRun} onClick={props.onRun}>
            <Play className="size-3.5" /> Run audit
          </Button>
        )}
        <p className="mt-2 text-center text-xs text-muted">Read-only: the audit never changes content.</p>
      </div>
    </div>
  );
}
