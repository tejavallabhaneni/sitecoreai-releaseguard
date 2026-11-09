/** Every tunable value Publish Guard reads. NEXT_PUBLIC_* values are inlined at build time. */

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const APP_NAME = process.env.NEXT_PUBLIC_RG_APP_NAME || "Publish Guard";
export const DEFAULT_LANGUAGE = process.env.NEXT_PUBLIC_RG_DEFAULT_LANGUAGE || "en";
export const CONTENT_ROOT = process.env.NEXT_PUBLIC_RG_CONTENT_ROOT || "/sitecore/content";
export const LANGUAGES_ROOT = "/sitecore/system/Languages";

/** Upper bound on items one audit may crawl. */
export const MAX_ITEMS_LIMIT = num(process.env.NEXT_PUBLIC_RG_MAX_ITEMS_LIMIT, 2000);
export const DEFAULT_MAX_ITEMS = num(process.env.NEXT_PUBLIC_RG_DEFAULT_MAX_ITEMS, 300);

export const SDK_TIMEOUT_MS = num(process.env.NEXT_PUBLIC_RG_SDK_TIMEOUT_MS, 20000);
export const GRAPHQL_TIMEOUT_MS = num(process.env.NEXT_PUBLIC_RG_GRAPHQL_TIMEOUT_MS, 30000);
export const HOST_STATE_TIMEOUT_MS = 2500;

/** Items read per aliased GraphQL request, and how many requests run at once. */
export const BATCH_SIZE = num(process.env.NEXT_PUBLIC_RG_BATCH_SIZE, 10);
export const CONCURRENCY = num(process.env.NEXT_PUBLIC_RG_CONCURRENCY, 4);

/** External link checking (server route). */
export const LINK_CHECK_TIMEOUT_MS = num(process.env.RG_LINK_CHECK_TIMEOUT_MS, 8000);
export const LINK_CHECK_MAX_URLS = 40;
export const MAX_EXTERNAL_URLS = num(process.env.NEXT_PUBLIC_RG_MAX_EXTERNAL_URLS, 400);
