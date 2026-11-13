# Publish Guard (code name ReleaseGuard)

A SitecoreAI Marketplace app for checking content before you publish. Personal project by
[Teja Vallabhaneni](https://teja-vallabhaneni.vercel.app).

![Publish Guard: a release verdict for the whole site](marketplace/screenshots/1-release-verdict.jpg)

## Summary

Publish Guard audits a whole SitecoreAI site, or any subtree, in one pass and tells you whether it is ready to
publish. It flags empty required fields, broken links and references, images without alt text, missing or
untranslated language versions, unapproved workflow states and components with missing datasources, then gives a
release verdict (**Not ready / Ready with warnings / Ready**) with an exportable CSV or JSON report. It is
read-only: it never creates, changes or deletes content.

- **Live demo:** <https://sitecoreai-releaseguard.vercel.app> (opens an offline demo outside Sitecore)
- **How-to guide:** [How to Use Publish Guard: Audit SitecoreAI Content Before You Publish](https://tejavallabhanenisitecore.wordpress.com/2026/11/09/publish-guard-sitecoreai-pre-publishing-content-audit/)

## Screenshots

| | |
|---|---|
| ![Release verdict](marketplace/screenshots/1-release-verdict.jpg) | ![Image descriptions](marketplace/screenshots/2-image-descriptions.jpg) |
| ![Links and references](marketplace/screenshots/3-links-and-references.jpg) | ![Languages](marketplace/screenshots/4-languages.jpg) |
| ![Publishing](marketplace/screenshots/5-publishing.jpg) | ![Audit setup](marketplace/screenshots/6-audit-setup.jpg) |

## Overview

Bulk content quality and pre-publishing audit for SitecoreAI. Point it at a site
or any item, pick the languages the content must exist in, and it reports
everything that would ship broken — before anyone clicks Publish.

Publish Guard is a **custom Marketplace app** (Next.js 16) opened from Cloud
Portal or from inside SitecoreAI. It reads the authoring (`master`) database
through the Authoring GraphQL API via the Marketplace SDK. **It never writes.**

## What it checks

| Category | Checks | Severity |
|---|---|---|
| **Required content** | Fields whose template field has the *Required* validator (`{59D4EE10-…}`) on any validation bar, in every audited language · values failing the field's *Validation* regex · configurable page fields (default `Title`) on items with a layout | error / warning |
| **Links & references** | General Link internal/media targets that no longer exist · rich-text `~/link.aspx?_id=` and `-/media/` links to deleted items · Droplink/Multilist/Treelist references to deleted items · empty links (`href="#"`, no URL) · external URLs that 404/410/5xx or fail DNS · `http://` links | error / warning / info |
| **Image descriptions** | Image fields with no alt on the field *and* no `Alt` on the media item · rich-text `<img>` with no `alt` attribute · images pointing at deleted media | error |
| **Languages** | Items with no version in a required language (error for pages, warning otherwise) · fields filled in the primary language but empty in a translation · no version in the primary language | error / warning |
| **Publishing** | Workflow state not final · *Never publish* · *Hide version* · future *Publish*/*Valid from* dates · past *Unpublish*/*Valid to* dates · locked items · components whose datasource or rendering definition is missing (`__Renderings` and `__Final Renderings`) | error / warning / info |

Results show a release verdict (**Not ready / Ready with warnings / Ready**), a
readiness score (share of items without errors), per-category counts, and a
filterable issue list grouped by item. Export as **CSV** or **JSON**.

## Run locally

```bash
npm install
npm run dev      # http://localhost:43160
```

In a normal browser tab the app runs an **offline demo** (a seeded "Northwind
Outdoor" site with one of most issue types, plus a "Demo data" chip). Inside a
Sitecore iframe it uses the real Marketplace session.

```bash
npm test         # vitest — parsers, rules, engine against the demo source
npm run lint
npm run build
```

## Install in Sitecore (App Studio)

1. Cloud Portal → **App studio** → **Studio** → **Create app** → custom app named `Publish Guard`.
2. **Deployment URL**: the origin the app is served from (production:
   <https://sitecoreai-releaseguard.vercel.app>; local: `http://localhost:43160`). Origin only.
3. **Extension point**: SitecoreAI full-screen, route `/sitecore` (or Standalone, route `/`).
4. **API access**: enable **SitecoreAI APIs** (this is what grants `xmc.authoring.graphql`).
5. **App logo**: upload [`public/branding/publish-guard-logo-512.png`](public/branding/publish-guard-logo-512.png).
6. Activate, then **Install** it on every environment you want to audit (My apps → Update installation options).

The app is **organization-private**: custom apps are only visible to your organization.

## How it works

```
src/lib/sitecore/sdk.ts           Marketplace SDK: init, application.context, xmc.authoring.graphql, Sites API
src/lib/sitecore/live-source.ts   Authoring GraphQL adapter (schema probe, aliased batch reads, template reader)
src/lib/sitecore/demo-source.ts   In-memory demo environment (also used by tests)
src/lib/audit/engine.ts           Crawl → read items per language → templates (+ bases) → bulk reference lookup → external links → rules
src/lib/audit/rules.ts            Every check, pure functions over what was read
src/lib/audit/parse.ts            Link / image / rich text / layout XML / date parsers
src/app/api/link-check/route.ts   Server-side external URL checker (HEAD→GET, manual redirects, blocks private/metadata IPs)
src/components/                   Settings panel, results, primitives
```

- Items are read with **aliased batch queries** (`i0: item(...) i1: item(...)`, 10 per request, 4 in flight).
- Template definitions are read once per template, including base templates, so inherited required fields count.
- Every reference (link targets, media, datasources, renderings, workflow states) is collected first and checked in bulk.
- The schema is probed once per environment (`__type(name: "Item")`) and the query shape falls back when a field is not available.

Configuration: see [`.env.example`](.env.example) — everything is optional.

## Deploy

Hosted on Vercel (Next.js preset, [`vercel.json`](vercel.json)). No database, no secrets: every audit runs in the
operator's browser through their own Sitecore session; the only server code is the external link checker.

```bash
npx vercel link --project sitecoreai-releaseguard
npx vercel --prod
```

## Brand

Design tokens live in [`src/app/globals.css`](src/app/globals.css) (raw `--pg-*` palette, then semantic names):
**Libre Franklin** as the only typeface, navy headings, a red button (2px border, 5px radius, bold, underline on
hover) for the primary action, and a navy footer with the Sitecore trademark notice.

| File | Use |
|---|---|
| `public/branding/publish-guard-logo-512.png` | The App studio **App logo** (white tile, halftone shield, "Publish" navy / "Guard" gradient). 1024px and SVG beside it. |
| `public/branding/publish-guard-mark.svg` | The halftone shield alone, used in the header. |
| `public/branding/publish-guard-icon.svg` | Coarser-grid shield for favicons (`src/app/icon.png`, `apple-icon.png`). |

The artwork is generated, not drawn: `node scripts/build-logo.js` writes the SVGs (halftone dots in the pink → purple
gradient, Libre Franklin ExtraBold outlined with opentype.js), `node scripts/render-logo.js` renders the PNGs (needs `sharp`).
Sitecore's own marks are used nowhere.

Sitecore® is a trademark of Sitecore Corporation A/S. Publish Guard is not affiliated with Sitecore.
