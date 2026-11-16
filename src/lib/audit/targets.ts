import type { AuditDepth, AuditTarget } from "@/lib/types";
import { normalizeId } from "./parse";

/**
 * The "Specific items" list: one path or item ID per line.
 *
 *   /sitecore/content/Site/Home/About        that item only
 *   /sitecore/content/Site/Home/News/*       the item and its direct children
 *   /sitecore/content/Site/Home/Products/**  the item and everything under it
 *
 * Blank lines and lines starting with # are ignored.
 */

const SUFFIX: Record<AuditDepth, string> = { item: "", children: "/*", subtree: "/**" };
const WIDTH: Record<AuditDepth, number> = { item: 0, children: 1, subtree: 2 };

/** One line of the list, or null for a blank line or comment. */
export function parseTargetLine(line: string): AuditTarget | null {
  let ref = line.trim();
  if (!ref || ref.startsWith("#")) return null;
  let depth: AuditDepth = "item";
  if (ref.endsWith("/**")) {
    depth = "subtree";
    ref = ref.slice(0, -3);
  } else if (ref.endsWith("/*")) {
    depth = "children";
    ref = ref.slice(0, -2);
  }
  ref = ref.trim().replace(/\/+$/, "");
  if (!ref) return null;
  return { ref, depth };
}

/** Same item, however it was written: IDs compare without braces or case, paths without case. */
export function targetKey(ref: string): string {
  return normalizeId(ref) || ref.toLowerCase();
}

/** Every target in the list, duplicates merged into the widest depth asked for. */
export function parseTargets(text: string): AuditTarget[] {
  const byKey = new Map<string, AuditTarget>();
  for (const line of text.split(/\r?\n/)) {
    const target = parseTargetLine(line);
    if (!target) continue;
    const key = targetKey(target.ref);
    const seen = byKey.get(key);
    if (!seen) byKey.set(key, target);
    else if (WIDTH[target.depth] > WIDTH[seen.depth]) byKey.set(key, { ...seen, depth: target.depth });
  }
  return [...byKey.values()];
}

export function formatTarget(target: AuditTarget): string {
  return `${target.ref}${SUFFIX[target.depth]}`;
}

/** Depth of `ref` in the list, or null when it is not listed. Matches the path or the ID. */
export function listedDepth(text: string, refs: string[]): AuditDepth | null {
  const keys = new Set(refs.filter(Boolean).map(targetKey));
  let found: AuditDepth | null = null;
  for (const t of parseTargets(text)) {
    if (keys.has(targetKey(t.ref)) && (found === null || WIDTH[t.depth] > WIDTH[found])) found = t.depth;
  }
  return found;
}

/**
 * The list with `refs` (an item's path and ID) set to `depth`, or removed when `depth` is null.
 * Other lines, comments included, are kept as written; a new entry is added at the end.
 */
export function setListedDepth(text: string, refs: string[], depth: AuditDepth | null, preferredRef: string): string {
  const keys = new Set(refs.filter(Boolean).map(targetKey));
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  let replaced = false;
  for (const line of lines) {
    const target = parseTargetLine(line);
    if (target && keys.has(targetKey(target.ref))) {
      if (depth && !replaced) {
        kept.push(formatTarget({ ref: target.ref, depth }));
        replaced = true;
      }
      continue;
    }
    kept.push(line);
  }
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  if (depth && !replaced) kept.push(formatTarget({ ref: preferredRef, depth }));
  return kept.join("\n");
}

export const DEPTH_LABEL: Record<AuditDepth, string> = {
  item: "This item",
  children: "+ children",
  subtree: "+ all below",
};

/** item → children → subtree → item. */
export function nextDepth(depth: AuditDepth): AuditDepth {
  return depth === "item" ? "children" : depth === "children" ? "subtree" : "item";
}
