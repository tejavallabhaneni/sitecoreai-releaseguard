import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/** What the fake ClientSDK does; swapped per test. */
const fake = {
  init: vi.fn<(config: unknown) => Promise<unknown>>(),
  mutate: vi.fn<(op: string, args: unknown) => Promise<unknown>>(),
  query: vi.fn<(op: string, args?: unknown) => Promise<unknown>>(),
};

vi.mock("@sitecore-marketplace-sdk/client", () => ({
  ClientSDK: { init: (config: unknown) => fake.init(config) },
}));
vi.mock("@sitecore-marketplace-sdk/xmc", () => ({ XMC: { name: "xmc" } }));

const sdk = await import("./sdk");
const { NotConnectedError, SitecoreRequestError, asRecord, authoringGraphQl, errorMessage, getClient, isMarketplaceHost, loadSession, readString, sitesApi } = sdk;

const client = {
  mutate: (op: string, args: unknown) => fake.mutate(op, args),
  query: (op: string, args?: unknown) => fake.query(op, args),
};

describe("helpers", () => {
  it("asRecord accepts plain objects only", () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(asRecord([])).toBeNull();
    expect(asRecord(null)).toBeNull();
    expect(asRecord("x")).toBeNull();
  });

  it("readString returns the first non-blank string, trimmed", () => {
    expect(readString(undefined, 3, "  ", " b ", "c")).toBe("b");
    expect(readString()).toBe("");
  });

  it("errorMessage handles Errors, strings, message records, and anything else", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("text")).toBe("text");
    expect(errorMessage({ message: "rec" })).toBe("rec");
    expect(errorMessage(new Error("  "))).toBe("Unknown error");
    expect(errorMessage(42)).toBe("Unknown error");
    expect(errorMessage({ title: "Bad Request" })).toBe("Bad Request");
    expect(errorMessage({ code: 7 })).toBe('{"code":7}');
    expect(errorMessage("<html><body><h1>Gateway Timeout</h1></body></html>")).toBe("Gateway Timeout");
  });
});

describe("outside a Sitecore iframe", () => {
  it("is not a Marketplace host and refuses to connect", async () => {
    expect(isMarketplaceHost()).toBe(false);
    await expect(getClient()).rejects.toBeInstanceOf(NotConnectedError);
  });
});

describe("inside a Sitecore iframe", () => {
  beforeAll(() => {
    vi.stubGlobal("window", { parent: { name: "host" } });
  });

  afterEach(() => {
    fake.mutate.mockReset();
    fake.query.mockReset();
    vi.useRealTimers();
  });

  it("is a Marketplace host when window.parent is not window", () => {
    expect(isMarketplaceHost()).toBe(true);
  });

  it("an SDK init failure is a NotConnectedError, and the next call retries", async () => {
    fake.init.mockRejectedValueOnce(new Error("handshake timed out"));
    await expect(getClient()).rejects.toThrow(/Marketplace SDK failed to initialize: handshake timed out/);
    fake.init.mockResolvedValue(client);
    expect(await getClient()).toBe(client);
    expect(await getClient()).toBe(client);
    expect(fake.init).toHaveBeenCalledTimes(2);
    expect(fake.init.mock.calls[1][0]).toMatchObject({ target: { name: "host" }, modules: [{ name: "xmc" }] });
  });

  describe("authoringGraphQl", () => {
    it("sends the query for the context ID", async () => {
      fake.mutate.mockResolvedValue({ data: { data: { item: null } } });
      await authoringGraphQl("ctx-1", "query X { a }");
      expect(fake.mutate).toHaveBeenCalledWith("xmc.authoring.graphql", {
        params: { query: { sitecoreContextId: "ctx-1" }, body: { query: "query X { a }", variables: {} } },
      });
    });

    it.each([
      ["{ data: { data: {...} } }", { data: { data: { item: { name: "x" } } } }, { data: { item: { name: "x" } }, errors: [] }],
      ["{ data: {...} } (one level)", { data: { item: { name: "x" } } }, { data: { item: { name: "x" } }, errors: [] }],
      [
        "{ data: { data: {...} }, response: ok }",
        { data: { data: { i0: null } }, error: undefined, response: { ok: true, status: 200 } },
        { data: { i0: null }, errors: [] },
      ],
      [
        "{ data: { data: null, errors } }",
        { data: { data: null, errors: [{ message: "Cannot query field 'workflow'" }, { code: 7 }] } },
        { data: null, errors: ["Cannot query field 'workflow'", '{"code":7}'] },
      ],
      [
        "{ data: { data: {...}, errors } } (partial)",
        { data: { data: { i0: { name: "a" }, i1: null }, errors: [{ message: "i1 failed" }] } },
        { data: { i0: { name: "a" }, i1: null }, errors: ["i1 failed"] },
      ],
      [
        "{ data: { errors } } (a request error with no data key, on HTTP 200)",
        { data: { errors: [{ message: "Syntax error" }] }, response: { ok: true, status: 200 } },
        { data: null, errors: ["Syntax error"] },
      ],
      [
        "HTTP 400 with GraphQL errors on `error`",
        { error: { errors: [{ message: "Unknown argument first" }] }, response: { ok: false, status: 400 } },
        { data: null, errors: ["Unknown argument first"] },
      ],
      [
        "HTTP 400 with a nested error body",
        { error: { data: { errors: [{ message: "nested" }] } }, response: { ok: false, status: 400 } },
        { data: null, errors: ["nested"] },
      ],
    ])("unwraps %s", async (_label, result, want) => {
      fake.mutate.mockResolvedValue(result);
      expect(await authoringGraphQl("ctx", "q")).toEqual(want);
    });

    it("throws on an HTTP failure without GraphQL errors", async () => {
      fake.mutate.mockResolvedValue({ error: "Service Unavailable", response: { ok: false, status: 503 } });
      await expect(authoringGraphQl("ctx", "q")).rejects.toThrow(
        "Authoring GraphQL failed with HTTP 503: this environment can't be reached (Service Unavailable).",
      );
      fake.mutate.mockResolvedValue({ response: { ok: false, status: 500 } });
      await expect(authoringGraphQl("ctx", "q")).rejects.toThrow("Authoring GraphQL failed with HTTP 500: Sitecore sent no details");
      fake.mutate.mockResolvedValue({ error: { message: "denied" } });
      await expect(authoringGraphQl("ctx", "q")).rejects.toThrow("Authoring GraphQL failed with an HTTP error: denied");
    });

    it("explains a 422 whose body has no message, instead of saying Unknown error", async () => {
      fake.mutate.mockResolvedValue({
        error: { type: "https://tools.ietf.org/html/rfc4918#section-11.2", title: "Unprocessable Entity", status: 422, errors: { "body.query": ["Query is too complex."] } },
        response: { ok: false, status: 422 },
      });
      const error = await authoringGraphQl("ctx", "q").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SitecoreRequestError);
      expect((error as InstanceType<typeof SitecoreRequestError>).status).toBe(422);
      expect((error as InstanceType<typeof SitecoreRequestError>).unreachable).toBe(false);
      expect((error as Error).message).toBe("Authoring GraphQL failed with HTTP 422: Unprocessable Entity; body.query: Query is too complex.");
    });

    it("summarizes a Cloudflare error page and flags the environment as unreachable", async () => {
      const page =
        '<!DOCTYPE html><html lang="en"><head><title>1016</title><style>body{font:x}</style></head><body>' +
        '<h1 class="error-title">A network error occurred</h1><p>Cloudflare is currently unable to resolve your requested domain.</p>' +
        "<ul><li>Ray ID: a5b1</li><li>Error reference number: 1016</li></ul></body></html>";
      fake.mutate.mockResolvedValue({ error: page, response: { ok: false, status: 530 } });
      const error = await authoringGraphQl("ctx", "q").catch((e: unknown) => e);
      expect((error as InstanceType<typeof SitecoreRequestError>).unreachable).toBe(true);
      expect((error as Error).message).toBe(
        "Authoring GraphQL failed with HTTP 530: this environment can't be reached " +
          "(A network error occurred — Cloudflare error 1016: the environment's host name no longer resolves). " +
          "It may be stopped, still being created, or deleted. Check it in Cloud Portal.",
      );
      expect((error as Error).message).not.toContain("<");
    });

    it("says what to check on a 403", async () => {
      fake.mutate.mockResolvedValue({ error: { error: "Forbidden" }, response: { ok: false, status: 403 } });
      await expect(authoringGraphQl("ctx", "q")).rejects.toThrow(
        "Authoring GraphQL failed with HTTP 403: Forbidden. Check that Publish Guard is installed on this environment and has SitecoreAI APIs access in App studio.",
      );
    });

    it("wraps a rejected SDK call", async () => {
      fake.mutate.mockRejectedValue(new Error("port closed"));
      await expect(authoringGraphQl("ctx", "q")).rejects.toThrow("Authoring GraphQL failed: port closed");
    });

    it("times out a call that never answers", async () => {
      vi.useFakeTimers();
      fake.mutate.mockReturnValue(new Promise(() => {}));
      const pending = authoringGraphQl("ctx", "q");
      const assertion = expect(pending).rejects.toThrow(/no response within 30s/);
      await vi.advanceTimersByTimeAsync(30_000);
      await assertion;
    });

    it("returns an empty envelope for a non-object result", async () => {
      fake.mutate.mockResolvedValue(undefined);
      expect(await authoringGraphQl("ctx", "q")).toEqual({ data: null, errors: [] });
    });
  });

  describe("sitesApi", () => {
    it.each([
      ["a bare array", [{ name: "a" }]],
      ["{ data: [...] }", { data: [{ name: "a" }] }],
      ["{ data: { data: [...] } }", { data: { data: [{ name: "a" }] } }],
    ])("unwraps %s", async (_label, result) => {
      fake.query.mockResolvedValue(result);
      expect(await sitesApi("xmc.sites.listSites", "ctx")).toEqual([{ name: "a" }]);
      expect(fake.query).toHaveBeenCalledWith("xmc.sites.listSites", { params: { query: { sitecoreContextId: "ctx" } } });
    });

    it("throws on an error and returns [] for anything else", async () => {
      fake.query.mockResolvedValue({ error: { message: "forbidden" } });
      await expect(sitesApi("xmc.sites.listLanguages", "ctx")).rejects.toThrow("forbidden");
      fake.query.mockResolvedValue({ data: { something: 1 } });
      expect(await sitesApi("xmc.sites.listLanguages", "ctx")).toEqual([]);
    });
  });

  describe("loadSession", () => {
    it("reads environments (live context first, de-duplicated) and the host language", async () => {
      fake.query.mockImplementation(async (op) =>
        op === "application.context"
          ? {
              data: {
                data: {
                  name: "ReleaseGuard Dev",
                  resourceAccess: [
                    { tenantDisplayName: "Prod", tenantName: "prod-t", context: { live: "live-1", preview: "prev-1" } },
                    { tenantName: "dup", context: { live: "live-1" } },
                    { environmentName: "Preview only", context: { preview: "prev-2" } },
                    { contextId: "bare" },
                    { tenantName: "none" },
                    "junk",
                  ],
                },
              },
            }
          : { data: { language: "fr-CA" } },
      );
      expect(await loadSession()).toEqual({
        applicationName: "ReleaseGuard Dev",
        environments: [
          { contextId: "live-1", name: "Prod", tenantName: "prod-t" },
          { contextId: "prev-2", name: "Preview only", tenantName: undefined },
          { contextId: "bare", name: "bare", tenantName: undefined },
        ],
        language: "fr-CA",
      });
    });

    it("throws NotConnectedError when application.context fails; host.state failing is fine", async () => {
      fake.query.mockResolvedValueOnce({ error: "nope" });
      await expect(loadSession()).rejects.toThrow("application.context failed with an HTTP error: nope");
      fake.query.mockImplementation(async (op) => {
        if (op === "host.state") throw new Error("unsupported");
        return { data: { resources: [{ contextId: "c" }] } };
      });
      expect(await loadSession()).toMatchObject({ environments: [{ contextId: "c" }], language: "", applicationName: "Publish Guard" });
    });
  });
});
