import type { ClientSDK } from "@sitecore-marketplace-sdk/client";
import { APP_NAME, GRAPHQL_TIMEOUT_MS, HOST_STATE_TIMEOUT_MS, SDK_TIMEOUT_MS } from "@/lib/config";
import type { Environment } from "@/lib/types";
import { describeFailure, failureDetail, isTransientFailure, looksLikeHtml, type DescribedFailure } from "./http-error";

/** Thrown when the Marketplace session cannot serve a request. */
export class NotConnectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotConnectedError";
  }
}

/** A request Sitecore answered with an error status. `unreachable`: the environment itself is not answering. */
export class SitecoreRequestError extends NotConnectedError {
  readonly status: number | null;
  readonly unreachable: boolean;
  constructor(failure: DescribedFailure) {
    super(failure.message);
    this.name = "SitecoreRequestError";
    this.status = failure.status;
    this.unreachable = failure.unreachable;
  }
}

export function isMarketplaceHost(): boolean {
  return typeof window !== "undefined" && window.parent !== window;
}

export function errorMessage(error: unknown): string {
  // An HTML error page (Cloudflare, a gateway) is summarized, never shown raw.
  const text = (value: string) => (looksLikeHtml(value) ? failureDetail(value).detail || "an HTML error page" : value);
  if (error instanceof Error && error.message.trim()) return text(error.message);
  if (typeof error === "string" && error.trim()) return text(error);
  const rec = asRecord(error);
  if (rec && typeof rec.message === "string" && rec.message.trim()) return text(rec.message);
  if (rec) return failureDetail(rec).detail || "Unknown error";
  return "Unknown error";
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function readString(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what}: no response within ${Math.round(ms / 1000)}s`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

let client: ClientSDK | null = null;
let inflight: Promise<ClientSDK> | null = null;

export async function getClient(): Promise<ClientSDK> {
  if (!isMarketplaceHost()) {
    throw new NotConnectedError(`${APP_NAME} is not inside a Sitecore iframe.`);
  }
  if (client) return client;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const [{ ClientSDK }, xmc] = await Promise.all([
        import("@sitecore-marketplace-sdk/client"),
        import("@sitecore-marketplace-sdk/xmc"),
      ]);
      client = await ClientSDK.init({
        target: window.parent,
        timeout: Math.max(SDK_TIMEOUT_MS, GRAPHQL_TIMEOUT_MS),
        modules: [xmc.XMC],
      });
      return client;
    } catch (error) {
      inflight = null;
      throw new NotConnectedError(`Marketplace SDK failed to initialize: ${errorMessage(error)}`);
    }
  })();
  return inflight;
}

export interface SessionInfo {
  applicationName: string;
  environments: Environment[];
  language: string;
}

/** Environments the app is installed on, from `application.context`. */
export async function loadSession(): Promise<SessionInfo> {
  const sdk = await getClient();
  const result = await withTimeout(sdk.query("application.context"), SDK_TIMEOUT_MS, "application.context");
  if (result.error) {
    const status = asRecord(asRecord(result)?.response)?.status;
    throw new SitecoreRequestError(describeFailure("application.context", typeof status === "number" ? status : null, result.error));
  }
  let rec = asRecord(result.data) ?? {};
  const nested = asRecord(rec.data);
  if (nested && !rec.resourceAccess && (nested.resourceAccess || nested.name)) rec = nested;
  const resources = Array.isArray(rec.resourceAccess)
    ? rec.resourceAccess
    : Array.isArray(rec.resources)
      ? rec.resources
      : [];
  const environments: Environment[] = [];
  for (const entry of resources) {
    const resource = asRecord(entry);
    if (!resource) continue;
    const context = asRecord(resource.context);
    const contextId = readString(context?.live, resource.contextId, context?.preview);
    if (!contextId || environments.some((e) => e.contextId === contextId)) continue;
    environments.push({
      contextId,
      name: readString(resource.tenantDisplayName, resource.environmentName, resource.tenantName) || contextId,
      tenantName: readString(resource.tenantName) || undefined,
      previewContextId: readString(context?.preview) || undefined,
    });
  }
  return {
    applicationName: readString(rec.name) || APP_NAME,
    environments,
    language: await hostLanguage(sdk),
  };
}

async function hostLanguage(sdk: ClientSDK): Promise<string> {
  try {
    const state = await withTimeout(sdk.query("host.state"), HOST_STATE_TIMEOUT_MS, "host.state");
    const rec = asRecord(state?.data) ?? {};
    const inner = asRecord(rec.data) ?? {};
    return readString(rec.language, inner.language, asRecord(rec.pageInfo)?.language);
  } catch {
    return "";
  }
}

/** Unwrap the SDK result down to the GraphQL `{ data, errors }` envelope. */
function graphQlEnvelope(result: unknown): { data: Record<string, unknown> | null; errors: string[] } {
  let current: unknown = result;
  for (let depth = 0; depth < 4; depth++) {
    const rec = asRecord(current);
    if (!rec) break;
    const inner = asRecord(rec.data);
    // `rec` is the envelope when it has errors, or when its `data` is the payload itself. A `data` that
    // holds `data` or `errors` is a wrapped envelope (a request error may carry `errors` and no `data`).
    if ("errors" in rec || ("data" in rec && inner && !("data" in inner) && !("errors" in inner))) {
      const errors = Array.isArray(rec.errors)
        ? rec.errors.map((e) => readString(asRecord(e)?.message) || JSON.stringify(e))
        : [];
      return { data: asRecord(rec.data), errors };
    }
    if ("data" in rec) {
      current = rec.data;
      continue;
    }
    break;
  }
  return { data: asRecord(current), errors: [] };
}

export interface GraphQlResponse {
  data: Record<string, unknown> | null;
  errors: string[];
}

/**
 * Waits before each retry of a transient failure. Sitecore's gateway intermittently answers
 * "422 Failed to process token exchange" (and sometimes 429 or 502-504) for a request that
 * succeeds when sent again; without a retry one such answer stopped a whole audit.
 */
export const RETRY_DELAYS_MS = [400, 1200, 3000];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Authoring GraphQL against one environment, via `xmc.authoring.graphql`. */
export async function authoringGraphQl(contextId: string, query: string): Promise<GraphQlResponse> {
  const sdk = await getClient();
  for (let attempt = 0; ; attempt++) {
    let raw: unknown;
    try {
      raw = await withTimeout(
        sdk.mutate("xmc.authoring.graphql", {
          params: { query: { sitecoreContextId: contextId }, body: { query, variables: {} } },
        } as never),
        GRAPHQL_TIMEOUT_MS,
        "Authoring GraphQL",
      );
    } catch (error) {
      throw new NotConnectedError(`Authoring GraphQL failed: ${errorMessage(error)}`);
    }
    // The XMC fetch client resolves non-2xx answers as `{ error, response }` instead of throwing.
    const rec = asRecord(raw);
    const response = asRecord(rec?.response);
    if (rec && (rec.error != null || response?.ok === false)) {
      const body = graphQlEnvelope(rec.error);
      // GraphQL validation errors arrive on a 400: hand them back so the caller can try a simpler shape.
      if (body.errors.length) return { data: null, errors: body.errors };
      const status = typeof response?.status === "number" ? response.status : null;
      if (attempt < RETRY_DELAYS_MS.length && isTransientFailure(status, rec.error)) {
        // A little jitter, so parallel requests that failed together do not retry together.
        await sleep(RETRY_DELAYS_MS[attempt] + Math.floor(Math.random() * 200));
        continue;
      }
      throw new SitecoreRequestError(describeFailure("Authoring GraphQL", status, rec.error));
    }
    return graphQlEnvelope(raw);
  }
}

/**
 * Experience Edge preview GraphQL (`xmc.preview.graphql`). Used only to learn the CM host that
 * serves item icons, so any failure is the caller's to ignore.
 */
export async function previewGraphQl(previewContextId: string, query: string, variables: Record<string, unknown> = {}): Promise<GraphQlResponse> {
  const sdk = await getClient();
  const raw = await withTimeout(
    sdk.mutate("xmc.preview.graphql" as never, { params: { query: { sitecoreContextId: previewContextId }, body: { query, variables } } } as never),
    SDK_TIMEOUT_MS,
    "Preview GraphQL",
  );
  const rec = asRecord(raw);
  if (rec && (rec.error != null || asRecord(rec.response)?.ok === false)) {
    const status = asRecord(rec.response)?.status;
    throw new SitecoreRequestError(describeFailure("Preview GraphQL", typeof status === "number" ? status : null, rec.error));
  }
  return graphQlEnvelope(raw);
}

/** `xmc.sites.listSites` / `xmc.sites.listLanguages` — the Sites REST API. */
export async function sitesApi(
  operation: "xmc.sites.listSites" | "xmc.sites.listLanguages",
  contextId: string,
): Promise<unknown[]> {
  const sdk = await getClient();
  const raw = await withTimeout(
    sdk.query(operation as never, { params: { query: { sitecoreContextId: contextId } } } as never),
    SDK_TIMEOUT_MS,
    operation,
  );
  let current: unknown = raw;
  for (let depth = 0; depth < 4; depth++) {
    if (Array.isArray(current)) return current;
    const rec = asRecord(current);
    if (!rec) break;
    if (rec.error) {
      const status = asRecord(rec.response)?.status;
      throw new SitecoreRequestError(describeFailure("Sites API", typeof status === "number" ? status : null, rec.error));
    }
    current = rec.data;
  }
  return [];
}
