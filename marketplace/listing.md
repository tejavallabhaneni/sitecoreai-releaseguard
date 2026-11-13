# Publish Guard — Sitecore Marketplace listing

Source of truth for the public App Studio listing. Keep this file and App Studio in sync.

> **To do before the next submission:** the live App Studio listing still uses the earlier Americaneagle.com links and contact email. Publish Guard is now a personal project, so add your own website, support, privacy policy and terms links below and in App Studio.

## App

| Field | Value |
|---|---|
| App name | SitecoreAI Publish Guard (public, `pub-816bb0b3-8804-457f-bfa4-81e00678d299`); custom org app: SitecoreAI Publish Guard (`c7c3b82e-1670-421a-a5c5-eb4cdf1a9583`) |
| Type | Public |
| App logo | `public/branding/publish-guard-logo-512.png` |
| Financial model | Free |
| Categories | Content management, Security and compliance |

## Headline (≤ 500)

Audit SitecoreAI content before you publish. Publish Guard scans a whole site or any subtree and flags empty required fields, broken internal, media and external links, images without alt text, missing or untranslated language versions, unapproved workflow states and components with missing datasources, then gives a clear release verdict.

## Description

Publish Guard is a bulk content quality and pre-publishing audit for SitecoreAI. Pick a site or any starting item, choose the languages your content must exist in, and run the audit. Publish Guard reads the authoring database and reports everything that would ship broken. It never writes to your content.

Required content: fields marked Required on their template (including inherited base templates) that are empty in any audited language, values that fail the field's validation pattern, and page fields you name, such as Title or MetaDescription.

Links and references: General Link and Rich Text links to deleted items or media, Droplink, Multilist and Treelist references to deleted items, empty links, insecure http:// links, and external URLs that return 404, 410 or 5xx or fail DNS.

Image descriptions: image fields with no alt text on the field or on the media item, and Rich Text images with no alt attribute, so pages meet accessibility requirements before they go live.

Languages: pages and items with no version in a required language, and fields that are filled in the primary language but left empty in a translation.

Publishing: versions in a workflow state that is not final, Never publish and Hide version, scheduled and expired publishing dates, locked items, and components whose rendering or datasource no longer exists.

Results: a release verdict (Not ready, Ready with warnings, Ready), a readiness score, counts per category, and a filterable issue list grouped by item with the field, language and exact target for each issue. Export the report as CSV or JSON.

Requirements: install the app on the SitecoreAI environments you want to audit. Any user who can open the app can run an audit; it only reads content.

## Links

| Field | Value |
|---|---|
| Website | https://teja-vallabhaneni.vercel.app |
| Support | https://github.com/tejavallabhaneni/sitecoreai-releaseguard/issues |
| Privacy policy | To add (see the to-do above) |
| Terms and conditions | To add (see the to-do above) |

## Data usage disclosure

The app does not collect analytics, tracking or personal data, and it does not use cookies for tracking. It reads SitecoreAI authoring content only when a user runs an audit, through the SitecoreAI APIs the host grants to the app, and it never creates, updates or deletes content.
The app does not store content on its servers. Audit results stay in the user's browser until they close the app, and exports are downloaded to the user's own device. The user's audit settings (checks, item limit, scope and page fields) are kept in the browser's local storage.
When "Check external URLs" is on, the external http(s) URLs found in the audited content are sent to the app's own server route, which requests each URL to read its HTTP status. The URLs are not logged or stored, and requests to private, loopback and cloud metadata addresses are refused.

## AI usage

The app does not use AI.

## Submission details

| Field | Value |
|---|---|
| Personal name | Teja Vallabhaneni |
| Email | (submitter email; not published here) |
| Security attestation | Ticked by the submitter after reviewing Sitecore's security checklist |

### Summary (≤ 500)

Publish Guard gives SitecoreAI teams a pre-publishing quality gate. It audits a whole site in one pass for empty required fields, broken links and references, missing alt text, missing or untranslated language versions, unapproved workflow and broken components, and returns a release verdict with an exportable report. It is read-only, built for teams who need confidence before every release.

## Configuration

| Field | Value |
|---|---|
| Extension points | Standalone (route `/`), SitecoreAI Full screen (route `/`) |
| API access | SitecoreAI APIs |
| Deployment URL | https://sitecoreai-releaseguard.vercel.app |

## Screenshots (1512×771)

1. `marketplace/screenshots/1-release-verdict.jpg` — verdict, readiness, category counts
2. `marketplace/screenshots/2-image-descriptions.jpg`
3. `marketplace/screenshots/3-links-and-references.jpg`
4. `marketplace/screenshots/4-languages.jpg`
5. `marketplace/screenshots/5-publishing.jpg`
6. `marketplace/screenshots/6-audit-setup.jpg`

Captured from the offline demo (sample "Northwind Outdoor" content), with the demo badge hidden.
