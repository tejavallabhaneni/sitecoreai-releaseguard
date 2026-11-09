import { describe, expect, it } from "vitest";
import {
  extractGuids,
  fieldKind,
  hasLayout,
  isBlank,
  isChecked,
  isEmptyGuid,
  isGuid,
  lockOwner,
  normalizeId,
  parseGeneralLink,
  parseImage,
  parseRenderings,
  parseRichText,
  parseSitecoreDate,
  readAttributes,
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

const G = "{110D559F-DEA5-42EA-9C1C-8A5DF7E70EF9}";
const G2 = "{220D559F-DEA5-42EA-9C1C-8A5DF7E70EF9}";

describe("normalizeId / isGuid", () => {
  it.each([
    ["braced upper", G],
    ["braced lower", G.toLowerCase()],
    ["unbraced", G.slice(1, -1)],
    ["no hyphens", G.replace(/[{}-]/g, "")],
    ["no hyphens, braced, lower", `{${G.replace(/[{}-]/g, "").toLowerCase()}}`],
    ["padded", `  ${G}  `],
  ])("normalizes %s", (_label, input) => {
    expect(normalizeId(input)).toBe(G);
  });

  it.each([["", ""], [null, ""], [undefined, ""], ["/sitecore/content", ""], ["110D559F-DEA5", ""], [`${G}0`, ""], ["zzzzzzzz-dea5-42ea-9c1c-8a5df7e70ef9", ""]])(
    "returns empty for %j",
    (input, want) => {
      expect(normalizeId(input as string)).toBe(want);
    },
  );

  it("isGuid accepts one GUID in any form and nothing else", () => {
    expect(isGuid(G)).toBe(true);
    expect(isGuid(G.replace(/[{}-]/g, ""))).toBe(true);
    expect(isGuid(` ${G} `)).toBe(true);
    expect(isGuid(`${G}|${G2}`)).toBe(false);
    expect(isGuid("/sitecore/content/home")).toBe(false);
    expect(isGuid(undefined)).toBe(false);
  });

  it("isEmptyGuid", () => {
    expect(isEmptyGuid("{00000000-0000-0000-0000-000000000000}")).toBe(true);
    expect(isEmptyGuid("00000000000000000000000000000000")).toBe(true);
    expect(isEmptyGuid(G)).toBe(false);
  });
});

describe("extractGuids", () => {
  it("reads pipe lists in mixed forms, de-duplicated, in order", () => {
    expect(extractGuids(`${G2}|${G.toLowerCase()}|${G.replace(/[{}-]/g, "")}`)).toEqual([G2, G]);
  });

  it("reads GUIDs out of XML and query strings", () => {
    expect(extractGuids(`<r id="${G}" /> ?sc_itemid=${G2.slice(1, -1)}&x=1`)).toEqual([G, G2]);
  });

  it("returns nothing for empty or GUID-free values", () => {
    expect(extractGuids("")).toEqual([]);
    expect(extractGuids("hello|world")).toEqual([]);
  });
});

describe("readAttributes / parseGeneralLink", () => {
  it("reads single- and double-quoted attributes, lower-casing names and decoding entities", () => {
    expect(readAttributes(` LinkType='external' Url="a?b=1&amp;c=&quot;2&quot;" title='it&#39;s &lt;ok&gt;'`)).toEqual({
      linktype: "external",
      url: 'a?b=1&c="2"',
      title: "it's <ok>",
    });
  });

  it("reads a general link with single quotes and entities", () => {
    expect(parseGeneralLink(`<link linktype='external' url='https://x.y/?a=1&amp;b=2' anchor='top' text='Tom &amp; Jerry' target='_blank' />`)).toEqual({
      linktype: "external",
      url: "https://x.y/?a=1&b=2",
      id: "",
      anchor: "top",
      text: "Tom & Jerry",
    });
  });

  it("lower-cases the link type and normalizes the ID", () => {
    expect(parseGeneralLink(`<link linktype="Internal" id="${G.toLowerCase()}"></link>`)).toMatchObject({ linktype: "internal", id: G });
  });

  it("returns null for whitespace or a non-link value", () => {
    expect(parseGeneralLink("   ")).toBeNull();
    expect(parseGeneralLink("https://x.y")).toBeNull();
    expect(parseGeneralLink("<image mediaid='x' />")).toBeNull();
  });

  it("returns empty strings for missing attributes", () => {
    expect(parseGeneralLink("<link />")).toEqual({ linktype: "", url: "", id: "", anchor: "", text: "" });
  });
});

describe("parseImage", () => {
  it("normalizes the media ID and keeps alt=\"\" distinct from no alt", () => {
    expect(parseImage(`<image mediaid='${G.replace(/[{}-]/g, "")}' alt='' />`)).toEqual({ mediaId: G, alt: "" });
    expect(parseImage(`<image mediaid="${G}" alt="Tom &amp; Jerry"></image>`)).toEqual({ mediaId: G, alt: "Tom & Jerry" });
  });

  it("returns null without a valid media ID", () => {
    expect(parseImage('<image mediaid="" />')).toBeNull();
    expect(parseImage('<image mediaid="not-a-guid" />')).toBeNull();
    expect(parseImage("")).toBeNull();
    expect(parseImage("plain text")).toBeNull();
  });
});

describe("parseRichText", () => {
  it("reads ~/link.aspx IDs in braced, hyphenated, and bare forms", () => {
    const { links } = parseRichText(
      `<a href="~/link.aspx?_id=${G}&amp;_z=z">a</a><a href='~/link.aspx?_id=${G.slice(1, -1)}'>b</a><A HREF="~/LINK.ASPX?_id=${G.replace(/[{}-]/g, "")}">c</A>`,
    );
    expect(links.map((l) => l.itemId)).toEqual([G, G, G]);
  });

  it("reads -/media/ and ~/media/ links as media", () => {
    const bare = G.replace(/[{}-]/g, "");
    const { links } = parseRichText(`<a href="-/media/${bare}.ashx">a</a><a href="~/media/${bare.toLowerCase()}.ashx?w=1">b</a>`);
    expect(links.map((l) => l.mediaId)).toEqual([G, G]);
    expect(links.every((l) => !l.itemId && !l.external)).toBe(true);
  });

  it("marks only http(s) links as external and keeps others raw", () => {
    const { links } = parseRichText('<a href=" HTTPS://x.y ">a</a><a href="mailto:a@b.c">b</a><a href="/rel">c</a><a name="x">d</a>');
    expect(links).toEqual([{ href: "HTTPS://x.y", external: "HTTPS://x.y" }, { href: "mailto:a@b.c" }, { href: "/rel" }]);
  });

  it("reads images: alt null vs empty, with and without a media ID", () => {
    const { images } = parseRichText(`<img src="/a.png" /><IMG alt='' src='-/media/${G.replace(/[{}-]/g, "")}.ashx'><img>`);
    expect(images).toEqual([{ src: "/a.png", alt: null }, { src: `-/media/${G.replace(/[{}-]/g, "")}.ashx`, alt: "", mediaId: G }, { src: "", alt: null }]);
  });

  it("returns empty lists for plain text", () => {
    expect(parseRichText("just text")).toEqual({ links: [], images: [] });
  });
});

describe("parseRenderings / hasLayout", () => {
  it("reads s:id / s:ds / s:ph / uid and skips the layout root", () => {
    const xml = `<r xmlns:p="p" xmlns:s="s" p:p="1"><d id="{FE5D7FDF-89C0-4D99-9AA3-B5FBD009C9F3}" l="${G2}"><r uid="${G2}" s:id="${G}" s:ph="main" s:ds="${G2}" /></d></r>`;
    expect(parseRenderings(xml)).toEqual([{ renderingId: G, datasource: G2, placeholder: "main", uid: G2 }]);
  });

  it("reads the plain id / ds / ph form", () => {
    const xml = `<r><d id="x"><r id="${G}" ph="content" ds="/sitecore/content/a"></r></d></r>`;
    expect(parseRenderings(xml)).toEqual([{ renderingId: G, datasource: "/sitecore/content/a", placeholder: "content", uid: "" }]);
  });

  it("keeps a datasource-only delta (Final Renderings) and skips a bare <r>", () => {
    expect(parseRenderings(`<r><r uid="${G2}" s:ds="local:/Data" /></r>`)).toEqual([
      { renderingId: "", datasource: "local:/Data", placeholder: "", uid: G2 },
    ]);
    expect(parseRenderings("<r/>")).toEqual([]);
  });

  it("ignores <rls>/<rule> elements and empty values", () => {
    expect(parseRenderings(`<r><rls><rule uid="${G}" /></rls></r>`)).toEqual([]);
    expect(parseRenderings("   ")).toEqual([]);
  });

  it("hasLayout is true for either layout field", () => {
    expect(hasLayout({})).toBe(false);
    expect(hasLayout({ renderings: "  " })).toBe(false);
    expect(hasLayout({ renderings: "<r/>" })).toBe(true);
    expect(hasLayout({ finalRenderings: "<r/>" })).toBe(true);
  });
});

describe("resolveDatasource", () => {
  const page = "/sitecore/content/site/home/";
  it.each([
    [G.toLowerCase(), G],
    [G.replace(/[{}-]/g, ""), G],
    ["/sitecore/content/site/Data/Hero", "/sitecore/content/site/Data/Hero"],
    ["local:/Data/Hero", "/sitecore/content/site/home/Data/Hero"],
    ["local:Data/Hero", "/sitecore/content/site/home/Data/Hero"],
    ["LOCAL://Data", "/sitecore/content/site/home/Data"],
    ["  ", null],
    ["", null],
    ["query:./ancestor::*", null],
    ["Data/Hero", null],
  ])("%j → %j", (ds, want) => {
    expect(resolveDatasource(ds, page)).toBe(want);
  });
});

describe("parseSitecoreDate", () => {
  it.each([
    ["20261109T143000Z", "2026-11-09T14:30:00.000Z"],
    ["20261109T143000", "2026-11-09T14:30:00.000Z"],
    ["20261109T143000:638123456789Z", "2026-11-09T14:30:00.000Z"],
    ["2026-11-09T14:30:00Z", "2026-11-09T14:30:00.000Z"],
    ["2026-11-09T14:30:00.000+02:00", "2026-11-09T12:30:00.000Z"],
    ["  20261109T000000Z  ", "2026-11-09T00:00:00.000Z"],
  ])("parses %j", (raw, iso) => {
    expect(parseSitecoreDate(raw)?.toISOString()).toBe(iso);
  });

  it.each([
    ["empty", ""],
    ["undefined", undefined],
    ["garbage", "not a date"],
    ["a bare number", "12"],
    ["zero", "0"],
    ["min value (compact)", "00010101T000000"],
    ["year < 1900 (compact)", "18991231T000000Z"],
    ["min value (ISO)", "0001-01-01T00:00:00Z"],
    ["month 13", "20261309T000000Z"],
    ["day 40", "20261140T000000Z"],
    ["hour 25", "20261109T250000Z"],
  ])("returns null for %s", (_label, raw) => {
    expect(parseSitecoreDate(raw)).toBeNull();
  });
});

describe("isChecked / lockOwner", () => {
  it("isChecked is only '1'", () => {
    expect(isChecked("1")).toBe(true);
    expect(isChecked(" 1 ")).toBe(true);
    expect(isChecked("0")).toBe(false);
    expect(isChecked("true")).toBe(false);
    expect(isChecked(undefined)).toBe(false);
  });

  it("lockOwner reads the owner, and an unlocked <r /> has none", () => {
    expect(lockOwner("<r owner='sitecore\\jo' date='20261109T000000Z' />")).toBe("sitecore\\jo");
    expect(lockOwner("<r />")).toBe("");
    expect(lockOwner('<r owner="" />')).toBe("");
    expect(lockOwner(undefined)).toBe("");
  });
});

describe("isBlank", () => {
  it.each([
    ["", true],
    [null, true],
    [undefined, true],
    ["  \n\t", true],
    ["&nbsp;", true],
    ["<p>&nbsp;</p>", true],
    ["<p>&#160;</p><br/>", true],
    ["<div><span> </span></div>", true],
    ["<p> </p>", true],
    ["Hi", false],
    ["0", false],
    ["a < b", false],
    ["<p>Hi</p>", false],
    ["&amp;", false],
    ['<image mediaid="{x}" />', false],
    ['<link linktype="internal" />', false],
    ['<iframe src="x"></iframe>', false],
    ["<video></video>", false],
  ])("%j → %s", (value, want) => {
    expect(isBlank(value as string)).toBe(want);
  });
});

describe("fieldKind / sniffKind", () => {
  it.each([
    ["General Link", "link"],
    ["general link with search", "link"],
    ["Link", "link"],
    ["Image", "image"],
    ["Rich Text", "richtext"],
    ["Droplink", "reference"],
    ["Droptree", "reference"],
    ["Multilist", "reference"],
    ["Multilist with Search", "reference"],
    ["Treelist", "reference"],
    ["TreelistEx", "reference"],
    ["Checklist", "reference"],
    ["Single-Line Text", "text"],
    [" multi-line text ", "text"],
    ["Droplist", "other"],
    ["Checkbox", "other"],
    ["Datetime", "other"],
    ["", "other"],
  ])("fieldKind(%j) = %s", (type, kind) => {
    expect(fieldKind(type)).toBe(kind);
  });

  it.each([
    ['  <link linktype="internal" />', "link"],
    ['<image mediaid="x" />', "image"],
    [G, "reference"],
    [G.replace(/[{}-]/g, ""), "reference"],
    [`${G}|${G2}`, "reference"],
    ["<p>x</p>", "richtext"],
    ["Text with <br/> break", "richtext"],
    ["<h2>Title</h2>", "richtext"],
    ["plain", "text"],
    ["a < b > c", "text"],
    [`${G}, ${G2}`, "text"],
  ])("sniffKind(%j) = %s", (value, kind) => {
    expect(sniffKind(value)).toBe(kind);
  });
});
