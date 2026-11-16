import { describe, expect, it } from "vitest";
import { decodeReport, encodeReport, EXPORT_PATH, reportLink, tokenFromHash } from "./report-link";

const csv = { name: "publish-guard-home-2026-11-16-17-20.csv", type: "text/csv", text: "Severity,Check\nerror,Required field is empty\n" };

describe("report links", () => {
  it("round-trips a report through the fragment, unchanged", async () => {
    const token = await encodeReport(csv);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await decodeReport(token)).toEqual(csv);
  });

  it("keeps non-ASCII text and large reports, compressed well under the URL limit", async () => {
    const text = "Severity,Message\n" + Array.from({ length: 5000 }, (_, i) => `warning,Kein Titel für Seite ${i} — über`).join("\n");
    const file = { name: "r.csv", type: "text/csv", text };
    const url = await reportLink("https://sitecoreai-releaseguard.vercel.app", file);
    expect(url.startsWith(`https://sitecoreai-releaseguard.vercel.app${EXPORT_PATH}#r=`)).toBe(true);
    expect(url.length).toBeLessThan(text.length / 4);
    expect((await decodeReport(tokenFromHash(new URL(url).hash))).text).toBe(text);
  });

  it("refuses a truncated or foreign token with a readable error", async () => {
    const token = await encodeReport(csv);
    await expect(decodeReport(token.slice(0, token.length - 10))).rejects.toThrow(/does not hold a complete report/);
    await expect(decodeReport("not-a-report")).rejects.toThrow(/does not hold a complete report/);
  });

  it("makes the file name a plain name", async () => {
    const token = await encodeReport({ ...csv, name: "../../etc/pass wd?.csv" });
    expect((await decodeReport(token)).name).toBe("..-..-etc-pass-wd-.csv");
  });

  it("reads the token from the fragment only in the expected form", () => {
    expect(tokenFromHash("#r=abc_DEF-123")).toBe("abc_DEF-123");
    expect(tokenFromHash("r=abc")).toBe("abc");
    expect(tokenFromHash("#x=abc")).toBe("");
    expect(tokenFromHash("#r=abc<script>")).toBe("");
    expect(tokenFromHash("")).toBe("");
  });
});
