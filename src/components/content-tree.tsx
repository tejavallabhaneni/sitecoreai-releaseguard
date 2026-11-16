"use client";

import { AlertCircle, ArrowUp, ChevronDown, ChevronRight, FileText, Folder, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { DEPTH_LABEL, listedDepth, nextDepth, parseTargets, setListedDepth } from "@/lib/audit/targets";
import { errorMessage } from "@/lib/sitecore/sdk";
import type { AuditSource } from "@/lib/sitecore/source";
import type { ItemRef } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button, Card } from "./ui";

/** Children shown per folder; a bigger folder is better listed by path with "/*". */
const TREE_PAGE = 500;

type Branch = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; kids: ItemRef[] };

function parentOf(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 1 ? `/${parts.slice(0, -1).join("/")}` : path;
}

export interface ContentTreeProps {
  source: AuditSource;
  language: string;
  /** Path the tree opens at. */
  rootPath: string;
  /** The "Specific items" list; ticking an item adds or removes its line. */
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
}

export function ContentTree({ source, language, rootPath, value, onChange, onClose }: ContentTreeProps) {
  const [path, setPath] = useState(rootPath);
  const [root, setRoot] = useState<Branch & { ref?: ItemRef }>({ state: "loading" });
  const [branches, setBranches] = useState<Record<string, Branch>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = useCallback(
    async (id: string) => {
      setBranches((b) => ({ ...b, [id]: { state: "loading" } }));
      try {
        const kids = await source.children(id, language, TREE_PAGE);
        setBranches((b) => ({ ...b, [id]: { state: "ready", kids } }));
      } catch (error) {
        setBranches((b) => ({ ...b, [id]: { state: "error", message: errorMessage(error) } }));
      }
    },
    [source, language],
  );

  // (Re)open the tree at `path`.
  useEffect(() => {
    let cancelled = false;
    setRoot({ state: "loading" });
    setBranches({});
    setOpen({});
    (async () => {
      try {
        const ref = await source.resolve(path, language);
        if (cancelled) return;
        if (!ref) {
          setRoot({ state: "error", message: `Nothing found at "${path}" in ${language}.` });
          return;
        }
        setRoot({ state: "ready", kids: [], ref });
        setOpen({ [ref.id]: true });
        await load(ref.id);
      } catch (error) {
        if (!cancelled) setRoot({ state: "error", message: errorMessage(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, language, path, load]);

  const toggle = (ref: ItemRef) => {
    const next = !open[ref.id];
    setOpen((o) => ({ ...o, [ref.id]: next }));
    if (next && !branches[ref.id]) void load(ref.id);
  };

  const count = parseTargets(value).length;

  return (
    <Card className="flex min-h-[420px] flex-col lg:h-full">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-navy">Content tree</h2>
          <p className="text-xs text-muted">
            Tick the items to audit. Use the button next to a ticked item to include its children or everything below it.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close the content tree">
          <X className="size-3.5" /> Close
        </Button>
      </div>

      <div className="flex items-center gap-2 border-b border-line px-4 py-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={parentOf(path) === path}
          onClick={() => setPath(parentOf(path))}
          title="Show the parent item"
        >
          <ArrowUp className="size-3.5" /> Up
        </Button>
        <span className="min-w-0 truncate font-mono text-xs text-muted" title={path}>
          {path}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {root.state === "loading" ? (
          <p className="flex items-center gap-2 px-2 py-3 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" /> Loading the content tree…
          </p>
        ) : root.state === "error" ? (
          <p className="flex items-start gap-2 px-2 py-3 text-sm text-error">
            <AlertCircle className="mt-0.5 size-4 shrink-0" /> {root.message}
          </p>
        ) : root.ref ? (
          <ul role="tree" aria-label="Content tree">
            <TreeRow
              item={root.ref}
              level={0}
              open={open}
              branches={branches}
              value={value}
              onToggle={toggle}
              onChange={onChange}
              onOpenHere={(p) => setPath(p)}
            />
          </ul>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3">
        <span className="text-xs text-muted">
          {count} item{count === 1 ? "" : "s"} in the list
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" disabled={!count} onClick={() => onChange("")}>
            Clear list
          </Button>
          <Button size="sm" variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Card>
  );
}

function TreeRow(props: {
  item: ItemRef;
  level: number;
  open: Record<string, boolean>;
  branches: Record<string, Branch>;
  value: string;
  onToggle: (ref: ItemRef) => void;
  onChange: (value: string) => void;
  onOpenHere: (path: string) => void;
}) {
  const { item, level, open, branches, value, onToggle, onChange } = props;
  const isOpen = Boolean(open[item.id]);
  const branch = branches[item.id];
  const refs = [item.path, item.id];
  const depth = listedDepth(value, refs);
  const ref = item.path || item.id;
  const Icon = item.hasChildren ? Folder : FileText;

  return (
    <li role="treeitem" aria-expanded={item.hasChildren ? isOpen : undefined} aria-selected={depth !== null}>
      <div
        className={cn("group flex min-h-8 items-center gap-1.5 rounded-[5px] pr-2 hover:bg-canvas", depth && "bg-brand-soft/60")}
        style={{ paddingLeft: `${level * 18 + 4}px` }}
      >
        {item.hasChildren ? (
          <button
            type="button"
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted hover:text-navy"
            onClick={() => onToggle(item)}
            aria-label={isOpen ? `Collapse ${item.name}` : `Expand ${item.name}`}
          >
            {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        ) : (
          <span className="size-5 shrink-0" />
        )}
        <input
          type="checkbox"
          className="size-4 shrink-0 accent-[var(--color-navy)]"
          checked={depth !== null}
          onChange={(e) => onChange(setListedDepth(value, refs, e.target.checked ? "item" : null, ref))}
          aria-label={`Audit ${item.name}`}
        />
        <Icon className="size-3.5 shrink-0 text-subtle" />
        <span className="min-w-0 truncate text-sm text-ink" title={item.path}>
          {item.name || item.id}
        </span>
        {item.templateName ? <span className="hidden min-w-0 truncate text-xs text-subtle sm:inline">{item.templateName}</span> : null}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {depth && item.hasChildren ? (
            <button
              type="button"
              className="h-6 rounded-full border border-navy bg-surface px-2 text-[11px] font-semibold text-navy hover:bg-navy hover:text-white"
              onClick={() => onChange(setListedDepth(value, refs, nextDepth(depth), ref))}
              title="Change how much of this item is audited"
            >
              {DEPTH_LABEL[depth]}
            </button>
          ) : depth ? (
            <span className="text-[11px] font-semibold text-navy">{DEPTH_LABEL.item}</span>
          ) : null}
          {item.hasChildren && level > 0 ? (
            <button
              type="button"
              className="h-6 rounded px-1.5 text-[11px] text-muted opacity-0 hover:text-navy focus:opacity-100 group-hover:opacity-100"
              onClick={() => props.onOpenHere(item.path)}
              title="Show only this part of the tree"
            >
              Open here
            </button>
          ) : null}
        </span>
      </div>
      {item.hasChildren && isOpen ? (
        branch?.state === "ready" ? (
          branch.kids.length ? (
            <ul role="group">
              {branch.kids.map((kid) => (
                <TreeRow key={kid.id} {...props} item={kid} level={level + 1} />
              ))}
              {branch.kids.length >= TREE_PAGE ? (
                <li className="py-1 text-xs text-muted" style={{ paddingLeft: `${(level + 1) * 18 + 30}px` }}>
                  Showing the first {TREE_PAGE}. List the rest by path, or tick this folder with “+ children”.
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="py-1 text-xs text-muted" style={{ paddingLeft: `${(level + 1) * 18 + 30}px` }}>
              No children.
            </p>
          )
        ) : branch?.state === "error" ? (
          <p className="py-1 text-xs text-error" style={{ paddingLeft: `${(level + 1) * 18 + 30}px` }}>
            {branch.message}
          </p>
        ) : (
          <p className="flex items-center gap-1.5 py-1 text-xs text-muted" style={{ paddingLeft: `${(level + 1) * 18 + 30}px` }}>
            <Loader2 className="size-3 animate-spin" /> Loading…
          </p>
        )
      ) : null}
    </li>
  );
}
