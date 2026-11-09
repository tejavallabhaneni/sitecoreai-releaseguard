/**
 * In-memory environment for the offline demo (a top-level browser tab, outside
 * Sitecore) and for tests. A small outdoor-retail site seeded with one example
 * of most issues the audit finds.
 */
import { normalizeId } from "@/lib/audit/parse";
import type { AuditItem, ExternalLinkResult, ItemRef, ReferenceInfo, SiteOption, StandardFields, TemplateDef } from "@/lib/types";
import type { AuditSource } from "./source";

const id = (n: number) => normalizeId(`${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`);

export const DEMO_IDS = {
  site: id(1),
  home: id(10),
  about: id(11),
  products: id(12),
  jacket: id(13),
  tent: id(14),
  boots: id(15),
  blog: id(16),
  guide: id(17),
  promo: id(18),
  contact: id(19),
  data: id(20),
  hero: id(21),
  banner: id(22),
  ghost: id(999),
  pageTemplate: id(100),
  seoTemplate: id(101),
  promoTemplate: id(102),
  folderTemplate: id(103),
  heroRendering: id(200),
  promoRendering: id(201),
  mediaJacket: id(300),
  mediaTent: id(301),
  mediaHero: id(302),
  wfDraft: id(400),
  wfApproved: id(401),
} as const;

const I = DEMO_IDS;
const ROOT = "/sitecore/content/Northwind/Northwind Outdoor";
const HOME = `${ROOT}/Home`;

interface DemoNode {
  id: string;
  name: string;
  path: string;
  parent: string | null;
  templateId: string;
  templateName: string;
  /** language → fields; a language missing here has no version. */
  versions: Record<string, Record<string, string>>;
  std?: StandardFields;
  /** Per-language standard fields, layered over `std`. */
  stdByLanguage?: Record<string, StandardFields>;
}

const link = (attrs: Record<string, string>) =>
  `<link ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(" ")} />`;
const image = (mediaId: string, alt?: string) => `<image mediaid="${mediaId}"${alt !== undefined ? ` alt="${alt}"` : ""} />`;
const layout = (...renderings: [string, string][]) =>
  `<r xmlns:p="p" xmlns:s="s" p:p="1"><d id="{FE5D7FDF-89C0-4D99-9AA3-B5FBD009C9F3}">${renderings
    .map(([rid, ds], i) => `<r uid="${id(900 + i)}" s:id="${rid}" s:ph="headless-main" s:ds="${ds}" />`)
    .join("")}</d></r>`;
const approved: StandardFields = { workflowState: I.wfApproved };

const page = (title: string, extra: Record<string, string> = {}) => ({
  Title: title,
  Content: `<p>${title} content for the spring release.</p>`,
  MetaDescription: `${title} — Northwind Outdoor.`,
  ...extra,
});

const NODES: DemoNode[] = [
  { id: I.site, name: "Northwind Outdoor", path: ROOT, parent: null, templateId: I.folderTemplate, templateName: "Site", versions: { en: {}, "fr-CA": {} } },
  {
    id: I.home, name: "Home", path: HOME, parent: I.site, templateId: I.pageTemplate, templateName: "Page",
    versions: {
      en: page("Welcome to Northwind", { Image: image(I.mediaHero) }),
      "fr-CA": page("Bienvenue chez Northwind", { Image: image(I.mediaHero) }),
    },
    std: { ...approved, renderings: layout([I.heroRendering, I.hero], [I.promoRendering, I.ghost]) },
  },
  {
    id: I.about, name: "About Us", path: `${HOME}/About Us`, parent: I.home, templateId: I.pageTemplate, templateName: "Page",
    versions: {
      en: page("About Northwind", { CallToAction: link({ linktype: "internal", id: I.contact, text: "Contact us" }) }),
      "fr-CA": { Title: "À propos de Northwind", Content: "", MetaDescription: "", CallToAction: link({ linktype: "internal", id: I.contact }) },
    },
    std: { ...approved, renderings: layout([I.heroRendering, I.hero]) },
  },
  {
    id: I.products, name: "Products", path: `${HOME}/Products`, parent: I.home, templateId: I.pageTemplate, templateName: "Page",
    versions: { en: page("Products"), "fr-CA": page("Produits") },
    std: { ...approved, renderings: layout([I.heroRendering, I.hero]) },
  },
  {
    id: I.jacket, name: "Trail Jacket", path: `${HOME}/Products/Trail Jacket`, parent: I.products, templateId: I.pageTemplate, templateName: "Page",
    versions: {
      en: page("Trail Jacket", { Image: image(I.mediaJacket) }),
      "fr-CA": page("Manteau de sentier", { Image: image(I.mediaJacket) }),
    },
    std: { workflowState: I.wfDraft, renderings: layout([I.heroRendering, I.hero]) },
  },
  {
    id: I.tent, name: "Summit Tent", path: `${HOME}/Products/Summit Tent`, parent: I.products, templateId: I.pageTemplate, templateName: "Page",
    versions: {
      en: page("Summit Tent", {
        Image: image(I.mediaTent),
        Content: `<p>See our <a href="~/link.aspx?_id=${I.ghost.replace(/[{}-]/g, "")}&amp;_z=z">care guide</a> and the <a href="https://broken.example.invalid/specs">full specs</a> or <a href="http://northwind.example.com/warranty">warranty</a>.</p>`,
      }),
      "fr-CA": page("Tente Summit", { Image: image(I.mediaTent) }),
    },
    std: { ...approved, renderings: layout([I.heroRendering, I.hero]) },
  },
  {
    id: I.boots, name: "Alpine Boots", path: `${HOME}/Products/Alpine Boots`, parent: I.products, templateId: I.pageTemplate, templateName: "Page",
    versions: { en: page("Alpine Boots", { Image: image(I.mediaHero, "Alpine boots on a rocky trail") }) },
    std: { ...approved, renderings: layout([I.heroRendering, I.hero]) },
  },
  {
    id: I.blog, name: "Blog", path: `${HOME}/Blog`, parent: I.home, templateId: I.pageTemplate, templateName: "Page",
    versions: { en: page("Blog"), "fr-CA": page("Blogue") },
    std: { ...approved, renderings: layout([I.heroRendering, I.hero]) },
  },
  {
    id: I.guide, name: "Spring Gear Guide", path: `${HOME}/Blog/Spring Gear Guide`, parent: I.blog, templateId: I.pageTemplate, templateName: "Page",
    versions: {
      en: page("Spring Gear Guide", {
        Content: `<p>Pack light.</p><img src="-/media/${I.mediaTent.replace(/[{}-]/g, "")}.ashx" /><p><a href="#">Read more</a></p>`,
        MetaDescription:
          "Everything you need for spring: jackets, tents, boots, packs, stoves, filters, headlamps, and the dozens of small things that make a weekend outside better than a weekend inside, all in one guide.",
      }),
      "fr-CA": page("Guide printemps"),
    },
    std: { ...approved, renderings: layout([I.heroRendering, I.hero]), publish: "20991231T000000Z" },
  },
  {
    id: I.promo, name: "Winter Clearance", path: `${HOME}/Blog/Winter Clearance`, parent: I.blog, templateId: I.pageTemplate, templateName: "Page",
    versions: { en: page("Winter Clearance"), "fr-CA": page("Liquidation d'hiver") },
    std: { ...approved, renderings: layout([I.heroRendering, I.hero]), unpublish: "20250301T000000Z", neverPublish: "1" },
  },
  {
    id: I.contact, name: "Contact", path: `${HOME}/Contact`, parent: I.home, templateId: I.pageTemplate, templateName: "Page",
    versions: {
      en: page("", { CallToAction: link({ linktype: "external", url: "" }) }),
      "fr-CA": page("Nous joindre"),
    },
    std: { ...approved, renderings: layout([I.heroRendering, I.hero]), lock: '<r owner="sitecore\\jordan.lee" date="20261108T101500Z" />' },
  },
  { id: I.data, name: "Data", path: `${ROOT}/Data`, parent: I.site, templateId: I.folderTemplate, templateName: "Folder", versions: { en: {}, "fr-CA": {} } },
  {
    id: I.hero, name: "Spring Hero", path: `${ROOT}/Data/Spring Hero`, parent: I.data, templateId: I.promoTemplate, templateName: "Promo",
    versions: {
      en: { Heading: "Gear up for spring", Image: image(I.mediaHero), Link: link({ linktype: "internal", id: I.products }), RelatedItems: "" },
      "fr-CA": { Heading: "Préparez-vous pour le printemps", Image: image(I.mediaHero), Link: link({ linktype: "internal", id: I.products }), RelatedItems: "" },
    },
    std: approved,
  },
  {
    id: I.banner, name: "Free Shipping Banner", path: `${ROOT}/Data/Free Shipping Banner`, parent: I.data, templateId: I.promoTemplate, templateName: "Promo",
    versions: {
      en: { Heading: "", Image: image(I.mediaJacket, ""), Link: link({ linktype: "external", url: "https://northwind.example.com/shipping" }), RelatedItems: `${I.tent}|${I.ghost}` },
      "fr-CA": { Heading: "Livraison gratuite", Image: image(I.mediaJacket, ""), Link: link({ linktype: "external", url: "https://northwind.example.com/shipping" }), RelatedItems: `${I.tent}|${I.ghost}` },
    },
    std: approved,
  },
];

const OUTSIDE: Record<string, { name: string; path: string; fields: Record<string, string> }> = {
  [I.heroRendering]: { name: "Hero", path: "/sitecore/layout/Renderings/Northwind/Hero", fields: {} },
  [I.mediaJacket]: { name: "trail-jacket", path: "/sitecore/media library/Northwind/trail-jacket", fields: { Alt: "" } },
  [I.mediaTent]: { name: "summit-tent", path: "/sitecore/media library/Northwind/summit-tent", fields: { Alt: "Two-person tent at dusk" } },
  [I.mediaHero]: { name: "spring-hero", path: "/sitecore/media library/Northwind/spring-hero", fields: { Alt: "Hikers on a ridge at sunrise" } },
  [I.wfDraft]: { name: "Draft", path: "/sitecore/system/Workflows/Sample Workflow/Draft", fields: { Final: "" } },
  [I.wfApproved]: { name: "Approved", path: "/sitecore/system/Workflows/Sample Workflow/Approved", fields: { Final: "1" } },
};

const TEMPLATES: TemplateDef[] = [
  {
    id: I.pageTemplate, name: "Page", path: "/sitecore/templates/Project/Northwind/Page", baseTemplateIds: [I.seoTemplate],
    fields: [
      { id: id(110), name: "Title", type: "Single-Line Text", section: "Content", required: true, shared: false, unversioned: false },
      { id: id(111), name: "Content", type: "Rich Text", section: "Content", required: false, shared: false, unversioned: false },
      { id: id(112), name: "Image", type: "Image", section: "Content", required: false, shared: false, unversioned: false },
      { id: id(113), name: "CallToAction", type: "General Link", section: "Content", required: false, shared: false, unversioned: false },
    ],
  },
  {
    id: I.seoTemplate, name: "_SEO", path: "/sitecore/templates/Project/Northwind/_SEO", baseTemplateIds: [],
    fields: [
      {
        id: id(120), name: "MetaDescription", type: "Multi-Line Text", section: "SEO", required: false, shared: false, unversioned: false,
        validation: "^[\\s\\S]{0,160}$", validationText: "Meta description should be 160 characters or fewer.",
      },
    ],
  },
  {
    id: I.promoTemplate, name: "Promo", path: "/sitecore/templates/Project/Northwind/Promo", baseTemplateIds: [],
    fields: [
      { id: id(130), name: "Heading", type: "Single-Line Text", section: "Promo", required: true, shared: false, unversioned: false },
      { id: id(131), name: "Image", type: "Image", section: "Promo", required: false, shared: false, unversioned: false },
      { id: id(132), name: "Link", type: "General Link", section: "Promo", required: false, shared: false, unversioned: false },
      { id: id(133), name: "RelatedItems", type: "Multilist", section: "Promo", required: false, shared: true, unversioned: false },
    ],
  },
  { id: I.folderTemplate, name: "Folder", path: "/sitecore/templates/Common/Folder", baseTemplateIds: [], fields: [] },
];

export const DEMO_LANGUAGES = ["en", "fr-CA"];

function delay(ms = 25) {
  return new Promise((r) => setTimeout(r, ms));
}

export class DemoSource implements AuditSource {
  readonly kind = "demo" as const;
  private byId = new Map(NODES.map((n) => [n.id, n]));
  private byPath = new Map(NODES.map((n) => [n.path.toLowerCase(), n]));

  constructor(private readonly latencyMs = 25) {}

  private find(ref: string): DemoNode | undefined {
    const nid = normalizeId(ref);
    return nid ? this.byId.get(nid) : this.byPath.get(ref.trim().replace(/\/+$/, "").toLowerCase());
  }

  private toRef(n: DemoNode): ItemRef {
    return {
      id: n.id,
      name: n.name,
      path: n.path,
      hasChildren: NODES.some((c) => c.parent === n.id),
      templateId: n.templateId,
      templateName: n.templateName,
    };
  }

  async listSites(): Promise<SiteOption[]> {
    await delay(this.latencyMs);
    return [{ id: "northwind", name: "Northwind Outdoor", rootId: I.site, rootPath: ROOT, languages: DEMO_LANGUAGES }];
  }

  async listLanguages(): Promise<string[]> {
    await delay(this.latencyMs);
    return [...DEMO_LANGUAGES, "de-DE"];
  }

  async resolve(pathOrId: string): Promise<ItemRef | null> {
    await delay(this.latencyMs);
    const n = this.find(pathOrId);
    return n ? this.toRef(n) : null;
  }

  async children(parentId: string, _language?: string, limit = Infinity): Promise<ItemRef[]> {
    await delay(this.latencyMs);
    return NODES.filter((n) => n.parent === normalizeId(parentId)).slice(0, limit).map((n) => this.toRef(n));
  }

  async readItems(ids: string[], language: string): Promise<Map<string, AuditItem | null>> {
    await delay(this.latencyMs * 2);
    const out = new Map<string, AuditItem | null>();
    for (const ref of ids) {
      const n = this.find(ref);
      if (!n) {
        out.set(ref, null);
        continue;
      }
      const fields = n.versions[language];
      out.set(ref, {
        id: n.id,
        name: n.name,
        path: n.path,
        templateId: n.templateId,
        templateName: n.templateName,
        language,
        hasVersion: Boolean(fields),
        version: fields ? 1 : 0,
        fields: { ...(fields ?? {}) },
        std: { ...(n.std ?? {}), ...(n.stdByLanguage?.[language] ?? {}) },
        workflow: null,
      });
    }
    return out;
  }

  async readTemplate(templateId: string): Promise<TemplateDef | null> {
    await delay(this.latencyMs);
    return TEMPLATES.find((t) => t.id === normalizeId(templateId)) ?? null;
  }

  async lookup(refs: string[], _language: string, extraFields: string[]): Promise<Map<string, ReferenceInfo>> {
    await delay(this.latencyMs);
    const out = new Map<string, ReferenceInfo>();
    for (const ref of refs) {
      const node = this.find(ref);
      const outside = OUTSIDE[normalizeId(ref)];
      if (!node && !outside) {
        out.set(ref, { exists: false, fields: {} });
        continue;
      }
      const fields: Record<string, string> = {};
      for (const f of extraFields) fields[f] = outside?.fields[f] ?? "";
      out.set(ref, { exists: true, id: node?.id ?? normalizeId(ref), name: node?.name ?? outside?.name, path: node?.path ?? outside?.path, fields });
    }
    return out;
  }
}

/** The demo's stand-in for the server link checker: no network. */
export async function demoExternalChecker(urls: string[]): Promise<ExternalLinkResult[]> {
  await delay(150);
  return urls.map((url) =>
    /\.invalid\b|broken/i.test(url)
      ? { url, ok: false, status: null, verdict: "broken", reason: "DNS lookup failed" }
      : { url, ok: true, status: 200, verdict: "ok" },
  );
}
