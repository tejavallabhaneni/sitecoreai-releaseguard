import { describe, expect, it } from "vitest";
import {
  extractGuids,
  isBlank,
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

describe("parse", () => {
  it("normalizes IDs in every shape", () => {
    const want = "{110D559F-DEA5-42EA-9C1C-8A5DF7E70EF9}";
    expect(normalizeId("110d559f-dea5-42ea-9c1c-8a5df7e70ef9")).toBe(want);
    expect(normalizeId("{110D559F-DEA5-42EA-9C1C-8A5DF7E70EF9}")).toBe(want);
    expect(normalizeId("110d559fdea542ea9c1c8a5df7e70ef9")).toBe(want);
    expect(normalizeId("/sitecore/content")).toBe("");
  });

  it("extracts GUID lists and skips the empty GUID", () => {
    expect(extractGuids("{110D559F-DEA5-42EA-9C1C-8A5DF7E70EF9}|{00000000-0000-0000-0000-000000000000}")).toEqual([
      "{110D559F-DEA5-42EA-9C1C-8A5DF7E70EF9}",
    ]);
  });

  it("reads general links", () => {
    expect(parseGeneralLink('<link linktype="internal" id="{110D559F-DEA5-42EA-9C1C-8A5DF7E70EF9}" text="Go" />')).toMatchObject({
      linktype: "internal",
      id: "{110D559F-DEA5-42EA-9C1C-8A5DF7E70EF9}",
      text: "Go",
    });
    expect(parseGeneralLink('<link linktype="external" url="https://a.b/?x=1&amp;y=2" />')?.url).toBe("https://a.b/?x=1&y=2");
    expect(parseGeneralLink("")).toBeNull();
  });

  it("reads image fields with and without alt", () => {
    expect(parseImage('<image mediaid="{110D559F-DEA5-42EA-9C1C-8A5DF7E70EF9}" />')).toEqual({
      mediaId: "{110D559F-DEA5-42EA-9C1C-8A5DF7E70EF9}",
      alt: null,
    });
    expect(parseImage('<image mediaid="{110D559F-DEA5-42EA-9C1C-8A5DF7E70EF9}" alt="A dog" />')?.alt).toBe("A dog");
    expect(parseImage("<image />")).toBeNull();
  });

  it("finds rich text links and images", () => {
    const rt = parseRichText(
      '<a href="~/link.aspx?_id=110D559FDEA542EA9C1C8A5DF7E70EF9&amp;_z=z">x</a><a href="https://x.y">y</a><a href="#">z</a><img src="-/media/110d559fdea542ea9c1c8a5df7e70ef9.ashx"><img src="/a.png" alt="">',
    );
    expect(rt.links[0].itemId).toBe("{110D559F-DEA5-42EA-9C1C-8A5DF7E70EF9}");
    expect(rt.links[1].external).toBe("https://x.y");
    expect(rt.links[2].href).toBe("#");
    expect(rt.images[0]).toMatchObject({ alt: null, mediaId: "{110D559F-DEA5-42EA-9C1C-8A5DF7E70EF9}" });
    expect(rt.images[1].alt).toBe("");
  });

  it("reads renderings and resolves datasources", () => {
    const xml =
      '<r xmlns:p="p" xmlns:s="s"><d id="{FE5D7FDF-89C0-4D99-9AA3-B5FBD009C9F3}"><r uid="{1}" s:id="{110D559F-DEA5-42EA-9C1C-8A5DF7E70EF9}" s:ph="main" s:ds="local:/Data/Hero" /></d></r>';
    const [r] = parseRenderings(xml);
    expect(r.renderingId).toBe("{110D559F-DEA5-42EA-9C1C-8A5DF7E70EF9}");
    expect(resolveDatasource(r.datasource, "/sitecore/content/site/home")).toBe("/sitecore/content/site/home/Data/Hero");
    expect(resolveDatasource("query:./*", "/x")).toBeNull();
  });

  it("parses Sitecore dates and lock owners", () => {
    expect(parseSitecoreDate("20261109T143000Z")?.toISOString()).toBe("2026-11-09T14:30:00.000Z");
    expect(parseSitecoreDate("")).toBeNull();
    expect(lockOwner('<r owner="sitecore\\admin" date="20261109T143000Z" />')).toBe("sitecore\\admin");
    expect(lockOwner("")).toBe("");
  });

  it("treats markup-only values as blank", () => {
    expect(isBlank("<p>&nbsp;</p>")).toBe(true);
    expect(isBlank("<p>Hi</p>")).toBe(false);
    expect(isBlank('<p><img src="a.png"></p>')).toBe(false);
  });

  it("sniffs field kinds", () => {
    expect(sniffKind("<link linktype='external' />")).toBe("link");
    expect(sniffKind("{110D559F-DEA5-42EA-9C1C-8A5DF7E70EF9}|{110D559F-DEA5-42EA-9C1C-8A5DF7E70EF0}")).toBe("reference");
    expect(sniffKind("<p>Hello</p>")).toBe("richtext");
    expect(sniffKind("Hello")).toBe("text");
  });
});

import { isPrivateAddress } from "@/lib/link-safety";

describe("link safety", () => {
  it("blocks private and metadata addresses", () => {
    for (const a of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(a)).toBe(true);
    }
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
    expect(isPrivateAddress("2606:2800:220:1::")).toBe(false);
  });
});
