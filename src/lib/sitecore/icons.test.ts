import { describe, expect, it } from "vitest";
import { absoluteOrigin, iconSources, iconText, isMediaFile } from "./icons";

const CM = "https://xmc-a.sitecorecloud.io";
const OTHER = "https://xmc-b.sitecorecloud.io";

describe("iconText", () => {
  it("reads a string, { url } or { value }", () => {
    expect(iconText(" Office/16x16/document.png ")).toBe("Office/16x16/document.png");
    expect(iconText({ url: "/-/icon/a.png" })).toBe("/-/icon/a.png");
    expect(iconText({ value: "b.png" })).toBe("b.png");
    expect(iconText(null)).toBe("");
    expect(iconText(7)).toBe("");
  });
});

describe("absoluteOrigin", () => {
  it("returns the origin of an absolute URL only", () => {
    expect(absoluteOrigin(`${CM}/-/icon/Office/32x32/folder.png`)).toBe(CM);
    expect(absoluteOrigin("/-/icon/a.png")).toBe("");
    expect(absoluteOrigin("Office/16x16/a.png")).toBe("");
  });
});

describe("iconSources", () => {
  it("tries the CM's static icon cache before /-/icon, at 16x16", () => {
    expect(iconSources(`${CM}/-/icon/Office/32x32/document.png`, CM)).toEqual([
      `${CM}/temp/iconcache/office/16x16/document.png`,
      `${CM}/-/icon/Office/16x16/document.png`,
    ]);
  });

  it("builds URLs for a relative or themed path once the host is known, and none before", () => {
    expect(iconSources("Office/32x32/folder.png", CM)).toEqual([`${CM}/temp/iconcache/office/16x16/folder.png`, `${CM}/-/icon/Office/16x16/folder.png`]);
    expect(iconSources("/-/icon/Office/24x24/link.png", CM)[1]).toBe(`${CM}/-/icon/Office/16x16/link.png`);
    expect(iconSources("Office/32x32/folder.png", "")).toEqual([]);
    expect(iconSources("", CM)).toEqual([]);
  });

  it("also tries other CMs' caches, which hold the same themed bitmaps", () => {
    expect(iconSources("Office/16x16/folder.png", CM, [CM, OTHER])).toEqual([
      `${CM}/temp/iconcache/office/16x16/folder.png`,
      `${OTHER}/temp/iconcache/office/16x16/folder.png`,
      `${CM}/-/icon/Office/16x16/folder.png`,
    ]);
  });

  it("uses a media item's own thumbnail in the form that needs no sign-in", () => {
    expect(iconSources(`${CM}/-/icon/-/media/abc.ashx?thn=1`, CM)).toEqual([`${CM}/-/media/abc.ashx?thn=1`]);
  });
});

describe("isMediaFile", () => {
  it("is true for a media library item without children", () => {
    expect(isMediaFile("/sitecore/media library/Images/hero", false)).toBe(true);
    expect(isMediaFile("/sitecore/media library/Images", true)).toBe(false);
    expect(isMediaFile("/sitecore/content/Home", false)).toBe(false);
  });
});
