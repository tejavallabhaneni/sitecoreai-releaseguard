// Builds WordPress (Gutenberg) block markup for the two how-to articles.
// Image blocks carry {{id:file}} / {{url:file}} placeholders that are swapped for
// Media Library IDs and URLs when the posts are created.
//   node docs/articles/build-articles.mjs   -> docs/articles/out/*.json + *.preview.html
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const B = {
  h2: (t) => `<!-- wp:heading -->\n<h2 class="wp-block-heading">${t}</h2>\n<!-- /wp:heading -->`,
  h3: (t) => `<!-- wp:heading {"level":3} -->\n<h3 class="wp-block-heading">${t}</h3>\n<!-- /wp:heading -->`,
  p: (t) => `<!-- wp:paragraph -->\n<p>${t}</p>\n<!-- /wp:paragraph -->`,
  ul: (items) => `<!-- wp:list -->\n<ul class="wp-block-list">${items.map((i) => `<!-- wp:list-item -->\n<li>${i}</li>\n<!-- /wp:list-item -->`).join("\n")}</ul>\n<!-- /wp:list -->`,
  ol: (items) => `<!-- wp:list {"ordered":true} -->\n<ol class="wp-block-list">${items.map((i) => `<!-- wp:list-item -->\n<li>${i}</li>\n<!-- /wp:list-item -->`).join("\n")}</ol>\n<!-- /wp:list -->`,
  img: (file, alt, caption) =>
    `<!-- wp:image {"id":{{id:${file}}},"sizeSlug":"large","linkDestination":"media"} -->\n<figure class="wp-block-image size-large"><a href="{{url:${file}}}"><img src="{{url:${file}}}" alt="${esc(alt)}" class="wp-image-{{id:${file}}}"/></a><figcaption class="wp-element-caption">${caption}</figcaption></figure>\n<!-- /wp:image -->`,
  table: (head, rows) =>
    `<!-- wp:table {"className":"is-style-stripes"} -->\n<figure class="wp-block-table is-style-stripes"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows
      .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
      .join("")}</tbody></table></figure>\n<!-- /wp:table -->`,
  tip: (t) => `<!-- wp:quote -->\n<blockquote class="wp-block-quote"><!-- wp:paragraph -->\n<p>${t}</p>\n<!-- /wp:paragraph --></blockquote>\n<!-- /wp:quote -->`,
  sep: () => `<!-- wp:separator -->\n<hr class="wp-block-separator has-alpha-channel-opacity"/>\n<!-- /wp:separator -->`,
};

const articles = [
  {
    key: "publish-guard",
    slug: "publish-guard-sitecoreai-pre-publishing-content-audit",
    title: "How to Use Publish Guard: Audit SitecoreAI Content Before You Publish",
    excerpt:
      "A step-by-step guide to Publish Guard, the SitecoreAI Marketplace app that audits a whole site for empty required fields, broken links, missing alt text, incomplete languages and publishing blockers before you release.",
    featured: "pg-cover-4x3.jpg",
    images: ["pg-01-setup.jpg", "pg-02-verdict.jpg", "pg-03-image-descriptions.jpg", "pg-04-links.jpg", "pg-05-languages.jpg", "pg-06-publishing.jpg"],
    blocks: [
      B.p("Every SitecoreAI release has the same last-minute questions. Did anyone leave a required field empty? Does that promo still link to a page we deleted? Do the new hero images have alt text? Is the French version of the product page actually there? Will the page even publish, or is it still sitting in a Draft workflow state?"),
      B.p("<strong>Publish Guard</strong> answers those questions in one pass. It is a SitecoreAI Marketplace app I built that audits a whole site (or any part of it) and reports everything that would ship broken, with a clear release verdict at the top. It is read-only: it never creates, changes or deletes content."),
      B.p("This guide walks through installing it, running your first audit, and turning the results into a fix list."),

      B.h2("What Publish Guard checks"),
      B.p("An audit covers five categories. You can switch any of them off before you run."),
      B.table(
        ["Category", "What it finds", "Severity"],
        [
          ["<strong>Required content</strong>", "Fields marked Required on their template (including inherited base templates) that are empty in any audited language; values that fail the field's validation pattern; page fields you name, such as Title or MetaDescription.", "Error / warning"],
          ["<strong>Links &amp; references</strong>", "General Link and Rich Text links to deleted items or media; Droplink, Multilist and Treelist references to deleted items; empty links (<code>#</code>, no URL); external URLs that return 404, 410 or 5xx or fail DNS; insecure <code>http://</code> links.", "Error / warning / info"],
          ["<strong>Image descriptions</strong>", "Image fields with no alt text on the field <em>and</em> none on the media item; Rich Text images with no <code>alt</code> attribute; images pointing at deleted media.", "Error"],
          ["<strong>Languages</strong>", "Items with no version in a language they should have (an error for pages, a warning for other items); fields filled in the primary language but empty in a translation.", "Error / warning"],
          ["<strong>Publishing</strong>", "Versions in a workflow state that is not final; Never publish and Hide version; scheduled and expired publishing dates; locked items; components whose rendering or datasource no longer exists.", "Error / warning / info"],
        ],
      ),
      B.p("<strong>Errors</strong> are things that will break a page, a link or accessibility once published. <strong>Warnings</strong> deserve a look but don't block the release. <strong>Info</strong> items are worth knowing, such as an <code>http://</code> link or a page scheduled to go live later."),

      B.h2("Before you start"),
      B.ol([
        "In <strong>Cloud Portal</strong>, open <strong>Marketplace</strong>, find <strong>Publish Guard</strong> and install it.",
        "Choose the SitecoreAI environments it should be able to read. You can change this later in <strong>My apps → Update installation options</strong>.",
        "Open it from the Cloud Portal app switcher, or from inside SitecoreAI as a full-screen app.",
      ]),
      B.p("No API keys or credentials are needed: Publish Guard uses the SitecoreAI APIs that the Marketplace grants to the app, and only the environments you installed it on appear in its list."),

      B.h2("Step 1: Choose the environment and scope"),
      B.img("pg-01-setup.jpg", "Publish Guard settings panel with environment, site, scope, languages and checks", "The settings panel: environment, site, scope, languages and checks."),
      B.ul([
        "<strong>Environment</strong>: every SitecoreAI environment the app is installed on.",
        "<strong>Site</strong>: picking a site sets the starting point to the site's root, so both its pages and its Data folder (where component datasources live) are audited.",
        "<strong>Start from</strong>: any item path (<code>/sitecore/content/…</code>) or item ID, if you want to audit a single section instead of the whole site.",
        "<strong>Scope</strong>: <em>Item and all descendants</em>, <em>Item and its children</em>, or <em>This item only</em>.",
        "<strong>Item limit</strong>: how many items one audit may read (300 by default, up to 2,000). If the limit is reached, the report says so, and you can raise it or narrow the starting item.",
      ]),

      B.h2("Step 2: Choose the languages"),
      B.p("Set the <strong>primary language</strong> (usually <code>en</code>), then tick every language each item should exist in under <strong>Languages every item should have</strong>. When you pick a site, Publish Guard preselects the site's own languages."),
      B.p("For each required language, Publish Guard checks that a version exists and that fields filled in the primary language are not left empty in the translation. Shared and unversioned fields are skipped, because they are the same in every language."),

      B.h2("Step 3: Pick the checks"),
      B.p("All five categories are on by default. Two options are worth knowing about:"),
      B.ul([
        "<strong>Check external URLs</strong> (under Links &amp; references) asks the app's server to request every external link it finds and read the HTTP status. Turn it off for a faster audit or if your content links to internal-only hosts. Requests to private, loopback and cloud metadata addresses are always refused.",
        "<strong>Page fields that must be filled</strong> is a comma-separated list (default: <code>Title</code>) checked on every item that has a layout, on top of the template's own Required fields. Add <code>MetaDescription</code>, <code>NavigationTitle</code> or anything else your sites rely on.",
      ]),
      B.p("Your choices of checks, page fields, scope and item limit are remembered in your browser for the next audit."),

      B.h2("Step 4: Run the audit"),
      B.p("Click <strong>Run audit</strong>. A progress card walks through five phases: <em>Find items</em>, <em>Read content</em> (every item in every selected language), <em>Read templates</em> (including base templates, so inherited Required fields count), <em>Check references</em> (every link target, media item, datasource and rendering, looked up in bulk), and <em>Check external links</em>. A typical site of a few hundred items finishes in seconds. You can cancel at any time."),

      B.h2("Step 5: Read the verdict"),
      B.img("pg-02-verdict.jpg", "Publish Guard results with the Not ready to publish verdict, readiness score and counts per category", "The verdict, readiness score and counts per category."),
      B.p("The banner at the top gives the release verdict:"),
      B.table(
        ["Verdict", "Meaning"],
        [
          ["<strong>Not ready to publish</strong>", "At least one error. Something will break a page, a link or accessibility once published."],
          ["<strong>Ready, with warnings</strong>", "No errors, but some content needs a look."],
          ["<strong>Ready to publish</strong>", "No errors or warnings in this scope."],
        ],
      ),
      B.p("The percentage on the right is the share of scanned items with no errors. Below it are the totals (items scanned, language versions read, errors, warnings, info) and one card per category. Click a category card to filter the issue list to it; click it again to clear the filter."),

      B.h2("Step 6: Work through the issues"),
      B.p("Issues are grouped by item, with the item's name and full path. Each issue shows what is wrong, the field and language, the exact target (a media path, a missing item ID, a URL) with a copy button, and a hint on how to fix it."),

      B.h3("Image descriptions"),
      B.img("pg-03-image-descriptions.jpg", "Image descriptions filter showing images with no alt text", "Images with no alt text, with the media item to fix."),
      B.p("Publish Guard looks for alt text on the image field first, then on the media item. If neither has any, it reports the media item's path, so you can add Alt text once in the Media Library and fix every page that uses that image. Rich Text images need an <code>alt</code> attribute; <code>alt=\"\"</code> is accepted as purposely decorative."),

      B.h3("Links and references"),
      B.img("pg-04-links.jpg", "Links and references filter showing references to missing items", "Links and references to items that no longer exist."),
      B.p("A broken internal link or reference shows the ID of the missing item. Usually the target was deleted or moved to another environment and never brought back. Point the field at the right item, or remove the reference. Broken external links show the HTTP status or reason (for example <em>DNS lookup failed</em>). Links the checker could not verify, such as a site that blocks automated requests with 403 or 429, are reported as info rather than errors."),

      B.h3("Languages"),
      B.img("pg-05-languages.jpg", "Languages filter showing a page with no fr-CA version and untranslated fields", "A page missing its fr-CA version, and fields left untranslated."),
      B.p("A page with no version in a required language is an error, because that page will not be available in that language. Other items (datasources, folders) are warnings. <em>Fields not translated</em> lists every field that has content in the primary language but is empty in the translation."),

      B.h3("Publishing"),
      B.img("pg-06-publishing.jpg", "Publishing filter showing a missing component datasource and a missing rendering", "Components whose datasource or rendering no longer exists."),
      B.p("Publishing issues are the ones that most often surprise people on release day:"),
      B.ul([
        "<strong>Workflow state is not final</strong>: Sitecore will skip this version when publishing. Approve it in workflow first.",
        "<strong>Component datasource is missing</strong> or <strong>Component rendering is missing</strong>: a component on the page points at an item that no longer exists, so it will render empty or fail. Both <code>__Renderings</code> and <code>__Final Renderings</code> are checked, including <code>local:</code> datasources.",
        "<strong>Never publish</strong> and <strong>Hide version</strong>: ticked restrictions that keep the item or version off the live site.",
        "<strong>Scheduled</strong> and <strong>expired</strong> dates: a Publish or Valid from date in the future, or an Unpublish or Valid to date in the past.",
        "<strong>Locked</strong>: someone has the item checked out, so their unsaved edits may not be in the release.",
      ]),

      B.h2("Filter and export the report"),
      B.ul([
        "<strong>Search</strong> by path, field, message or URL.",
        "Toggle <strong>Error</strong>, <strong>Warning</strong> and <strong>Info</strong>.",
        "Pick a single <strong>language</strong>.",
        "<strong>Collapse all</strong> to scan the list of affected items.",
        "<strong>CSV</strong> exports every issue (severity, category, check, item path, item ID, language, field, message, target), ready to sort in Excel or attach to a ticket. <strong>JSON</strong> exports the full report including the settings used.",
      ]),
      B.p("After fixing content in SitecoreAI, click <strong>Run audit</strong> again to confirm the verdict changes."),

      B.h2("Good to know"),
      B.ul([
        "<strong>Read-only.</strong> Publish Guard never writes to your content. It reads the authoring (master) database, so it sees drafts and unpublished changes: exactly what you are about to publish.",
        "<strong>Required fields</strong> are the ones with Sitecore's Required validator on any of the template field's validation rule fields. If your templates enforce \"required\" another way, list those fields under <em>Page fields that must be filled</em>.",
        "<strong>Query datasources</strong> (<code>query:</code>) can't be resolved without running them, so they are not checked.",
        "<strong>No data is stored on a server.</strong> Results stay in your browser until you close the app. Exports are downloaded to your device. Only your settings are remembered, in your browser's local storage.",
        "<strong>Large sites:</strong> audit one section at a time, or raise the item limit (up to 2,000).",
      ]),

      B.h2("FAQ"),
      B.h3("Does Publish Guard change or publish anything?"),
      B.p("No. It only reads content and reports what it finds."),
      B.h3("Who can run it?"),
      B.p("Anyone in your organization who can open the app. It uses the SitecoreAI access the Marketplace grants to the app on the environments it is installed on."),
      B.h3("Why is a page \"Not ready\" when it looks fine in Pages?"),
      B.p("The usual causes are a version still in a Draft workflow state, a component whose datasource was deleted, or a missing translation for a language your site requires. The issue list names the exact field, language and target."),
      B.h3("Can I audit just one page?"),
      B.p("Yes. Paste the page's path or item ID into <em>Start from</em> and choose <em>This item only</em>."),

      B.sep(),
      B.p("Publish Guard is a personal project by Teja Vallabhaneni. For questions, open an issue on <a href=\"https://github.com/tejavallabhaneni/sitecoreai-releaseguard/issues\">GitHub</a>. Its sibling app, <em>Content Transfer</em>, copies content between SitecoreAI environments. A how-to guide for it is also on this blog."),
    ],
  },
  {
    key: "content-transfer",
    slug: "content-transfer-copy-content-between-sitecoreai-environments",
    title: "How to Use Content Transfer: Copy Content Between SitecoreAI Environments",
    excerpt:
      "A step-by-step guide to Content Transfer, the SitecoreAI Marketplace app that copies content from one environment to another the way the Sitecore 10 Package Manager did: pick items, choose what happens if they exist, review every change, then execute.",
    featured: "ct-cover-4x3.jpg",
    images: ["ct-01-choose-environments.jpg", "ct-02-select-content.jpg", "ct-03-install-options.jpg", "ct-04-review.jpg", "ct-05-done.jpg", "ct-06-run-history.jpg"],
    blocks: [
      B.p("Most SitecoreAI customers run several environments: a development sandbox, staging, production. Content built in one of them has to end up in the others. Packages and serialization are developer tools; they work on files and pipelines. Neither lets a content author say <em>copy these eleven pages to staging, and show me what that will change before it changes anything</em>."),
      B.p("<strong>Content Transfer</strong> is that tool. It is a SitecoreAI Marketplace app I built that shows two environments' content trees side by side, lets you pick what should move, shows exactly what would change, and only writes when you press Execute. If you used the Sitecore 10 Package Manager, the options will feel familiar."),

      B.h2("Before you start"),
      B.ol([
        "In <strong>Cloud Portal</strong>, open <strong>Marketplace</strong>, find <strong>Content Transfer</strong> and install it.",
        "Install it on <strong>both</strong> environments: the one you copy from and the one you copy to. A transfer needs at least two. Add more later in <strong>My apps → Update installation options</strong>.",
        "Open it from the Cloud Portal app switcher, or from inside SitecoreAI as a full-screen app.",
      ]),
      B.tip("Copies run through Sitecore's Content Transfer API whenever possible, which keeps item IDs, every version and language, and media files. That API needs the <strong>Organization Admin</strong> or <strong>Owner</strong> role in Cloud Portal. Other users can still copy with <em>item-by-item copy</em>, where item IDs differ on the destination and media files are not carried."),

      B.p("The app has three steps, shown in a stepper at the top: <strong>Choose environments</strong>, <strong>Select content</strong>, and <strong>Review &amp; execute</strong>."),

      B.h2("Step 1: Choose environments"),
      B.img("ct-01-choose-environments.jpg", "Choose environments step with Dev as Copy from and Staging as Copy to", "Pick Copy from and Copy to. The destination is never preselected."),
      B.ul([
        "<strong>Copy from</strong>: the environment that has the content.",
        "<strong>Copy to</strong>: where it should go. This is never preselected, so you can't aim a transfer at production by accident.",
        "The <strong>⇆</strong> button swaps them.",
        "Only environments the app is installed on appear. Missing one? Install the app on it in <strong>My apps</strong>.",
      ]),
      B.p("Click <strong>Continue</strong>. Nothing is read from either environment until you do."),

      B.h2("Step 2: Select content"),
      B.img("ct-02-select-content.jpg", "Select content step with source and destination trees side by side", "Source on the left, destination on the right, your selection below."),
      B.p("The two trees sit side by side. The left one (<strong>Copy from</strong>) is where you choose; the right one (<strong>Copy to</strong>) is read-only and shows what the destination has today. When you click an item on the left, its path is highlighted on the right if it already exists there. Workflow badges (<em>Approved</em>, <em>Awaiting Approval</em>) show each item's state."),
      B.ul([
        "Click an item, then <strong>Add item</strong> to copy just that item.",
        "Or <strong>Add with subitems</strong> to copy the item and everything under it. Every descendant is ticked, so you can untick any you want to leave behind.",
        "Use <strong>Search</strong> above either tree to find items quickly.",
        "Use <strong>Paste paths</strong> to add many items at once from a list of item paths or IDs.",
      ]),
      B.p("Everything you add appears in the <strong>Selected</strong> strip, with how many items are under it and the option you chose. Remove any entry with ✕, or <strong>Clear all</strong>."),

      B.h3("Choose what happens if an item already exists"),
      B.img("ct-03-install-options.jpg", "Install options dialog with Overwrite, Merge, Skip and Keep both", "The same choices as the Sitecore 10 installation wizard."),
      B.p("Each time you add, Content Transfer asks what to do if the item already exists on the destination:"),
      B.table(
        ["Option", "What it does"],
        [
          ["<strong>Overwrite</strong>", "Replaces the item. Items under it on the destination that aren't in the source are deleted (moved to the Recycle Bin, after you confirm)."],
          ["<strong>Merge</strong> → Clear", "Keeps the item and replaces its versions with the source's."],
          ["<strong>Merge</strong> → Append", "Keeps the item and adds the source's versions as new versions."],
          ["<strong>Merge</strong> → Merge", "Replaces versions with the same number and adds the rest."],
          ["<strong>Skip</strong>", "Leaves the existing item as it is."],
          ["<strong>Keep both</strong>", "Adds a second copy next to the existing one."],
        ],
      ),
      B.p("Tick <strong>Apply to all</strong> to use the same answer for the rest of this session."),
      B.p("When your selection is ready, click <strong>Review</strong>."),

      B.h2("Step 3: Review"),
      B.img("ct-04-review.jpg", "Review step with New, Updated, No change and Deleted counts and the plan table", "Review shows exactly what will change. Nothing is written yet."),
      B.p("Review compares every selected item with the destination and builds a plan. <strong>It writes nothing.</strong>"),
      B.ul([
        "The counts at the top: <strong>New</strong>, <strong>Updated</strong>, <strong>No change</strong> and <strong>Deleted</strong>.",
        "<strong>How it will be copied</strong> explains which items go through Sitecore's Content Transfer API and which are copied item by item, and why.",
        "One row per item, saying <em>what happens</em> (Create, Update, No change, Delete) and the details: which versions and languages, and whether the parent exists.",
        "Every row has a <strong>Keep</strong> checkbox. Untick a row to leave that item out without starting again.",
        "Notices at the top flag anything worth reading first, such as missing parents that will be created, or items not yet approved in workflow.",
      ]),
      B.p("Changed something in the source meanwhile? Click <strong>Run review again</strong>."),

      B.h2("Execute"),
      B.p("Click <strong>Execute in [destination]</strong>. If the plan deletes anything, which only Overwrite can do, you are asked to confirm first, and deleted items go to the Recycle Bin. Progress is shown as the transfer runs, and you can cancel."),
      B.p("Items are written in a safe order: templates, then media, then items (parents before children). Then reference fields are relinked to the destination's items. Deletions come last."),
      B.tip("<strong>Publish to Experience Edge after executing</strong> is off by default. Tick it (on the Selected strip or beside Execute) to publish the copied items once the execute finishes with no failures. Without it, nothing changes on the live site until someone publishes."),

      B.h2("Done"),
      B.img("ct-05-done.jpg", "Done screen with Created, Updated, Skipped and Deleted counts and every item listed", "The Done screen: what landed, what didn't, and exports."),
      B.p("The Done screen shows the outcome, the counts (<strong>Created</strong>, <strong>Updated</strong>, <strong>Skipped</strong>, <strong>Deleted</strong>), and every item with what happened to it, including the new item's ID on the destination."),
      B.ul([
        "If anything did not land, <strong>Promote N missed</strong> retries just those items.",
        "<strong>Download report</strong>, <strong>Copy JSON</strong> or <strong>CSV</strong> keep a record of the run.",
        "<strong>Copy more</strong> starts a new selection between the same two environments.",
      ]),

      B.h2("Run history"),
      B.img("ct-06-run-history.jpg", "Run history table listing past transfers", "Past runs, kept in your browser."),
      B.p("<strong>Run history</strong> (top right) lists the transfers run in this browser: when, from where to where, what, the counts, and the outcome. It is stored in your browser's local storage, not on a server."),

      B.h2("Two ways content is copied"),
      B.p("Content Transfer chooses the engine per item and tells you which it picked during Review:"),
      B.table(
        ["Option", "Engine"],
        [
          ["Overwrite, with subitems", "Sitecore Content Transfer API (when every descendant is ticked)"],
          ["Overwrite, item only", "Sitecore Content Transfer API"],
          ["Skip", "Sitecore Content Transfer API"],
          ["Missing parents", "Sitecore Content Transfer API, so they keep their IDs"],
          ["Merge (Clear / Append / Merge), Keep both", "Item-by-item copy (the API has no equivalent)"],
        ],
      ),
      B.p("The Content Transfer API keeps item IDs, every version and language, and media files. Item-by-item copy also copies page layouts, rewriting component datasource IDs to the destination's items."),

      B.h2("Good to know"),
      B.ul([
        "<strong>It copies authoring content.</strong> Trees, comparisons and writes use the authoring (master) database: the latest saved version, drafts included. Nothing is visible on the destination's live site until it is published.",
        "<strong>Review never writes.</strong> Only Execute writes, and publishing is a separate opt-in.",
        "<strong>No field-level diff.</strong> A row says an item differs; it doesn't list which fields.",
        "<strong>Check before writing to production.</strong> Content Transfer doesn't treat any environment specially, so read the Review carefully, especially the Deleted count.",
        "<strong>Every selected item is accounted for.</strong> If something you selected can't be copied, the plan names it and says why.",
      ]),

      B.h2("FAQ"),
      B.h3("Will item IDs be the same on the destination?"),
      B.p("Yes, when the copy runs through the Content Transfer API (Overwrite, Skip, and missing parents). Merge and Keep both use item-by-item copy, which creates new IDs."),
      B.h3("Does it copy media?"),
      B.p("Media files travel with the Content Transfer API. Media Library items can be selected and copied like any other item."),
      B.h3("Can I undo a transfer?"),
      B.p("Items deleted by Overwrite go to the destination's Recycle Bin and can be restored there. Created and updated items are not rolled back automatically, so keep the downloaded report as your record."),
      B.h3("What if I only have one environment installed?"),
      B.p("A transfer needs a source and a destination. Install the app on a second environment in My apps."),

      B.sep(),
      B.p("Content Transfer is a personal project by Teja Vallabhaneni. Its sibling app, <em>Publish Guard</em>, audits content for broken links, missing alt text, incomplete languages and publishing blockers before you release. A how-to guide for it is also on this blog."),
    ],
  },
];

const outDir = path.join(here, "out");
fs.mkdirSync(outDir, { recursive: true });
for (const a of articles) {
  const content = a.blocks.join("\n\n");
  fs.writeFileSync(path.join(outDir, `${a.key}.json`), JSON.stringify({ ...a, blocks: undefined, content }, null, 2));
  // Local preview with the images inlined from ../images.
  const preview = content
    .replace(/\{\{url:([^}]+)\}\}/g, "../images/$1")
    .replace(/\{\{id:[^}]+\}\}/g, "0");
  fs.writeFileSync(
    path.join(outDir, `${a.key}.preview.html`),
    `<!doctype html><meta charset="utf-8"><title>${esc(a.title)}</title><style>body{font:17px/1.6 Georgia,serif;max-width:760px;margin:40px auto;padding:0 16px;color:#222}img{max-width:100%;height:auto}figcaption{font:13px sans-serif;color:#666;text-align:center}table{border-collapse:collapse;width:100%;font:15px sans-serif}td,th{border:1px solid #ddd;padding:8px;vertical-align:top;text-align:left}blockquote{border-left:4px solid #8a2be2;margin:1em 0;padding:.2em 1em;background:#f6f2fd}code{background:#f2f2f2;padding:0 3px}</style><h1>${esc(a.title)}</h1><p><em>${esc(a.excerpt)}</em></p>${preview}`,
  );
  console.log(a.key, content.length, "chars,", a.blocks.length, "blocks");
}
