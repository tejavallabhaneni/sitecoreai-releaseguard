import { describe, expect, it } from "vitest";
import { describeFailure, failureDetail, isTransientFailure, looksLikeHtml } from "./http-error";

describe("failureDetail", () => {
  it("reads messages from GraphQL envelopes, problem details and plain strings", () => {
    expect(failureDetail({ errors: [{ message: "a" }, { message: "b" }] }).detail).toBe("a; b");
    expect(failureDetail({ title: "Unprocessable Entity", detail: "Bad item path" }).detail).toBe("Unprocessable Entity; Bad item path");
    expect(failureDetail({ errors: { Query: ["Required.", "Too long."], $: ["Bad JSON."] } }).detail).toBe("Query: Required. Too long.; Bad JSON.");
    expect(failureDetail({ error: { error_description: "token expired" } }).detail).toBe("token expired");
    expect(failureDetail("  Service Unavailable ").detail).toBe("Service Unavailable");
  });

  it("falls back to JSON for an unknown shape, and to nothing for an empty one", () => {
    expect(failureDetail({ status: 422, traceId: "x1" }).detail).toBe('{"status":422,"traceId":"x1"}');
    expect(failureDetail({}).detail).toBe("");
    expect(failureDetail(null).detail).toBe("");
    expect(failureDetail(42).detail).toBe("");
  });

  it("drops repeats and clips long text", () => {
    expect(failureDetail({ message: "same", title: "same" }).detail).toBe("same");
    const long = failureDetail({ message: "x".repeat(1000) }).detail;
    expect(long.length).toBeLessThanOrEqual(300);
    expect(long.endsWith("…")).toBe(true);
  });

  it("summarizes HTML pages without markup, styles or scripts", () => {
    const html = "<html><head><title>502 Bad Gateway</title><script>var a='<b>'</script></head><body><p>nginx</p></body></html>";
    expect(failureDetail(html)).toEqual({ detail: "502 Bad Gateway", cloudflareCode: undefined });
    const cf = "<html><title>1033</title><h1>Argo Tunnel error</h1><p>Error code 1033</p></html>";
    expect(failureDetail(cf)).toEqual({ detail: "Argo Tunnel error — Cloudflare error 1033: the environment's tunnel is down", cloudflareCode: "1033" });
    expect(failureDetail("<div>a &amp; b&nbsp;c</div>").detail).toBe("a & b c");
  });

  it("recognizes HTML", () => {
    expect(looksLikeHtml("<!DOCTYPE html><html>")).toBe(true);
    expect(looksLikeHtml("  <html lang='en'>")).toBe(true);
    expect(looksLikeHtml("<p>x</p>")).toBe(true);
    expect(looksLikeHtml("a < b and c > d")).toBe(false);
  });
});

describe("describeFailure", () => {
  it("flags gateway and Cloudflare origin failures as unreachable", () => {
    for (const status of [502, 503, 504, 520, 522, 530]) {
      expect(describeFailure("X", status, "").unreachable).toBe(true);
    }
    expect(describeFailure("X", 200, "<html><p>Error reference number: 1016</p></html>").unreachable).toBe(true);
    expect(describeFailure("X", 500, "boom").unreachable).toBe(false);
    expect(describeFailure("X", 422, {}).unreachable).toBe(false);
  });

  it("writes one sentence per kind of failure", () => {
    expect(describeFailure("Authoring GraphQL", 504, "").message).toBe(
      "Authoring GraphQL failed with HTTP 504: this environment can't be reached. It may be stopped, still being created, or deleted. Check it in Cloud Portal.",
    );
    expect(describeFailure("Sites API", 401, "").message).toBe(
      "Sites API failed with HTTP 401. Check that Publish Guard is installed on this environment and has SitecoreAI APIs access in App studio.",
    );
    expect(describeFailure("Authoring GraphQL", 429, { message: "slow down" }).message).toBe(
      "Authoring GraphQL failed with HTTP 429: Sitecore is limiting requests (slow down). Wait a minute and try again.",
    );
    expect(describeFailure("Authoring GraphQL", 422, {}).message).toBe("Authoring GraphQL failed with HTTP 422: Sitecore sent no details");
    expect(describeFailure("Authoring GraphQL", null, "nope").message).toBe("Authoring GraphQL failed with an HTTP error: nope");
  });
});

describe("isTransientFailure", () => {
  it("is true for a failed token exchange, rate limiting and gateway hiccups", () => {
    expect(isTransientFailure(422, { title: "Unprocessable", detail: "Failed to process token exchange" })).toBe(true);
    for (const status of [429, 502, 503, 504]) expect(isTransientFailure(status, "")).toBe(true);
  });

  it("is false for a gone environment and for requests that are wrong", () => {
    expect(isTransientFailure(422, { title: "Unprocessable", detail: "Query is too complex" })).toBe(false);
    for (const status of [400, 401, 403, 404, 500, 530]) expect(isTransientFailure(status, "")).toBe(false);
    expect(isTransientFailure(null, "")).toBe(false);
  });
});
