import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dns = vi.hoisted(() => ({
  lookup: vi.fn<(host: string, opts: unknown) => Promise<{ address: string; family: number }[]>>(),
}));
vi.mock("node:dns/promises", () => ({ lookup: dns.lookup, default: { lookup: dns.lookup } }));

const { checkLink, MAX_REDIRECTS } = await import("./link-check");
const { POST } = await import("@/app/api/link-check/route");
const { LINK_CHECK_MAX_URLS, LINK_CHECK_TIMEOUT_MS } = await import("./config");

/** A minimal Response stand-in (Response itself refuses statuses like 999). */
function res(status: number, headers: Record<string, string> = {}): Response {
  return { status, headers: new Headers(headers), body: null } as unknown as Response;
}

const fetchMock = vi.fn<(url: URL, init: RequestInit) => Promise<Response>>();
const calls = () => fetchMock.mock.calls.map(([url, init]) => `${init.method} ${url.toString()}`);
const publicIp = (...addresses: string[]) => dns.lookup.mockResolvedValue(addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  dns.lookup.mockReset();
  publicIp("93.184.216.34");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("checkLink: refusing to call", () => {
  it("a malformed URL is broken without any request", async () => {
    expect(await checkLink("not a url")).toEqual({ url: "not a url", ok: false, status: null, verdict: "broken", reason: "Malformed URL" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["ftp://example.com/file", "unsupported protocol"],
    ["https://user:pw@example.com/", "credentials in URL"],
    ["http://localhost:3000/", "private host"],
    ["http://app.localhost/", "private host"],
    ["http://metadata.google.internal/", "private host"],
    ["http://10.0.0.1/", "private address"],
    ["http://169.254.169.254/latest/meta-data", "private address"],
    ["http://[::1]/", "private address"],
    ["http://[::ffff:127.0.0.1]/", "private address"],
    ["http://2130706433/", "private address"],
  ])("%s is unverified (%s), with no request", async (url, reason) => {
    expect(await checkLink(url)).toEqual({ url, ok: false, status: null, verdict: "unverified", reason: `Not checked: ${reason}` });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not resolve IP literals through DNS", async () => {
    fetchMock.mockResolvedValue(res(200));
    await checkLink("http://93.184.216.34/");
    expect(dns.lookup).not.toHaveBeenCalled();
  });

  it("a host resolving to a private address (any of them) is unverified", async () => {
    publicIp("93.184.216.34", "10.0.0.5");
    expect(await checkLink("https://sneaky.example.com/")).toMatchObject({ verdict: "unverified", reason: "Not checked: private address" });
    expect(dns.lookup).toHaveBeenCalledWith("sneaky.example.com", { all: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a host resolving to nothing is unverified", async () => {
    dns.lookup.mockResolvedValue([]);
    expect(await checkLink("https://empty.example.com/")).toMatchObject({ verdict: "unverified" });
  });

  it.each(["ENOTFOUND", "EAI_AGAIN", "ENODATA"])("DNS failure %s is broken", async (code) => {
    dns.lookup.mockRejectedValue(Object.assign(new Error(`getaddrinfo ${code} nope.example`), { code }));
    expect(await checkLink("https://nope.example/")).toEqual({ url: "https://nope.example/", ok: false, status: null, verdict: "broken", reason: "DNS lookup failed" });
  });

  it("another DNS error is unverified", async () => {
    dns.lookup.mockRejectedValue(Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" }));
    expect(await checkLink("https://x.example/")).toMatchObject({ verdict: "unverified", reason: "Not checked: connection refused" });
  });
});

describe("checkLink: HTTP answers", () => {
  it("200 on HEAD is ok, sent with manual redirects and our user agent", async () => {
    fetchMock.mockResolvedValue(res(200));
    expect(await checkLink("https://example.com/a")).toEqual({ url: "https://example.com/a", ok: true, status: 200, verdict: "ok" });
    expect(calls()).toEqual(["HEAD https://example.com/a"]);
    const init = fetchMock.mock.calls[0][1];
    expect(init.redirect).toBe("manual");
    expect((init.headers as Record<string, string>)["user-agent"]).toMatch(/ReleaseGuard/);
  });

  it.each([405, 501, 400, 403])("HEAD %i is retried as GET", async (status) => {
    fetchMock.mockResolvedValueOnce(res(status)).mockResolvedValueOnce(res(204));
    expect(await checkLink("https://example.com/")).toMatchObject({ verdict: "ok", status: 204 });
    expect(calls()).toEqual(["HEAD https://example.com/", "GET https://example.com/"]);
  });

  it("404 is broken, without a GET retry", async () => {
    fetchMock.mockResolvedValue(res(404));
    expect(await checkLink("https://example.com/gone")).toEqual({ url: "https://example.com/gone", ok: false, status: 404, verdict: "broken", reason: "HTTP 404" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([500, 410])("%i is broken", async (status) => {
    fetchMock.mockResolvedValue(res(status));
    expect(await checkLink("https://example.com/")).toMatchObject({ verdict: "broken", status });
  });

  it.each([401, 403, 429, 999])("%i is unverified (blocked, not broken)", async (status) => {
    fetchMock.mockResolvedValue(res(status));
    expect(await checkLink("https://example.com/")).toEqual({ url: "https://example.com/", ok: false, status, verdict: "unverified", reason: `HTTP ${status}` });
  });

  it("follows a relative redirect and reports the original URL", async () => {
    fetchMock.mockResolvedValueOnce(res(301, { location: "/new" })).mockResolvedValueOnce(res(200));
    expect(await checkLink("https://example.com/old")).toMatchObject({ url: "https://example.com/old", verdict: "ok" });
    expect(calls()).toEqual(["HEAD https://example.com/old", "HEAD https://example.com/new"]);
  });

  it("blocks a redirect to a private address", async () => {
    fetchMock.mockResolvedValueOnce(res(302, { location: "http://169.254.169.254/latest/meta-data" }));
    expect(await checkLink("https://example.com/")).toMatchObject({ verdict: "unverified", reason: "Not checked: private address" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("blocks a redirect to a host that resolves privately", async () => {
    fetchMock.mockResolvedValueOnce(res(307, { location: "https://internal.example.com/" }));
    dns.lookup.mockImplementation(async (host) => [{ address: host === "internal.example.com" ? "192.168.1.10" : "93.184.216.34", family: 4 }]);
    expect(await checkLink("https://example.com/")).toMatchObject({ verdict: "unverified", reason: "Not checked: private address" });
  });

  it("a redirect without Location is broken", async () => {
    fetchMock.mockResolvedValue(res(302));
    expect(await checkLink("https://example.com/")).toMatchObject({ verdict: "broken", status: 302, reason: "Redirect without Location" });
  });

  it(`stops after ${MAX_REDIRECTS} redirects`, async () => {
    fetchMock.mockImplementation(async () => res(302, { location: "/loop" }));
    expect(await checkLink("https://example.com/")).toMatchObject({ verdict: "broken", reason: "Too many redirects" });
    expect(fetchMock).toHaveBeenCalledTimes(MAX_REDIRECTS + 1);
  });

  it("a connection failure is unverified", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    expect(await checkLink("https://example.com/")).toMatchObject({ verdict: "unverified", reason: "Connection failed (fetch failed)" });
  });

  it("a request that hangs times out as unverified", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const pending = checkLink("https://slow.example.com/");
    await vi.advanceTimersByTimeAsync(LINK_CHECK_TIMEOUT_MS);
    expect(await pending).toMatchObject({ verdict: "unverified", reason: "Timed out" });
  });
});

describe("POST /api/link-check", () => {
  const post = (body: string) => POST(new Request("http://localhost/api/link-check", { method: "POST", body, headers: { "content-type": "application/json" } }));

  it("rejects a non-JSON body", async () => {
    const r = await post("{oops");
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "Expected a JSON body." });
  });

  it.each([["{}"], ['{"urls":"x"}'], ['{"urls":[1]}'], ["null"]])("rejects %s", async (body) => {
    const r = await post(body);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "Expected { urls: string[] }." });
  });

  it(`rejects more than ${LINK_CHECK_MAX_URLS} URLs`, async () => {
    const r = await post(JSON.stringify({ urls: Array.from({ length: LINK_CHECK_MAX_URLS + 1 }, (_, i) => `https://e.com/${i}`) }));
    expect(r.status).toBe(413);
  });

  it("checks each unique URL once, truncated to 2048 characters, uncached", async () => {
    fetchMock.mockResolvedValue(res(200));
    const long = `https://example.com/${"a".repeat(3000)}`;
    const r = await post(JSON.stringify({ urls: ["https://example.com/", "https://example.com/", long, "bad url"] }));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const { results } = await r.json();
    expect(results.map((x: { url: string; verdict: string }) => [x.url.length, x.verdict])).toEqual([
      [20, "ok"],
      [2048, "ok"],
      [7, "broken"],
    ]);
  });
});
