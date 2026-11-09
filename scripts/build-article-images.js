/* eslint-disable @typescript-eslint/no-require-imports -- plain Node build script */
/**
 * Article images for the WordPress how-to posts (docs/articles/raw -> docs/articles/images):
 * each capture framed in a light card, plus a 1600x900 cover per article.
 *   NODE_PATH=<dir with sharp> node scripts/build-article-images.js
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const opentype = require("opentype.js");
const f800 = opentype.loadSync(require.resolve("@fontsource/libre-franklin/files/libre-franklin-latin-800-normal.woff"));
const f700 = opentype.loadSync(require.resolve("@fontsource/libre-franklin/files/libre-franklin-latin-700-normal.woff"));
const f400 = opentype.loadSync(require.resolve("@fontsource/libre-franklin/files/libre-franklin-latin-400-normal.woff"));

const dir = path.join(__dirname, "..", "docs/articles");
const raw = path.join(dir, "raw");
const out = path.join(dir, "images");
fs.mkdirSync(out, { recursive: true });

const rounded = (w, h, r) => Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" fill="#fff"/></svg>`);

async function frame(file) {
  const W = 1600, pad = 40, r = 12;
  const meta = await sharp(path.join(raw, file)).metadata();
  const cw = W - pad * 2, ch = Math.round((cw * meta.height) / meta.width);
  const H = ch + pad * 2;
  const shot = await sharp(path.join(raw, file)).resize(cw, ch).composite([{ input: rounded(cw, ch, r), blend: "dest-in" }]).png().toBuffer();
  const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><filter id="s" x="-5%" y="-5%" width="110%" height="115%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#003057" flood-opacity="0.16"/></filter></defs>
  <rect width="${W}" height="${H}" fill="#eef2f7"/><rect x="${pad}" y="${pad}" width="${cw}" height="${ch}" rx="${r}" fill="#fff" stroke="#d5dbe3" filter="url(#s)"/></svg>`;
  await sharp(Buffer.from(bg)).composite([{ input: shot, left: pad, top: pad }]).jpeg({ quality: 86 }).toFile(path.join(out, file));
}

function text(font, s, size, x, y, fill, ls = 0) {
  return `<path d="${font.getPath(s, x, y, size, { letterSpacing: ls }).toPathData(2)}" fill="${fill}"/>`;
}

async function cover(name, logoFile, eyebrow, titleLines, sub, shotFile) {
  // 4:3, because the blog theme crops featured images to 4:3.
  const W = 1600, H = 1200;
  const logo = await sharp(logoFile).resize(150, 150).png().toBuffer();
  const meta = await sharp(path.join(raw, shotFile)).metadata();
  const sw = 940, sh = Math.round((sw * meta.height) / meta.width);
  const shot = await sharp(path.join(raw, shotFile)).resize(sw, sh).composite([{ input: rounded(sw, sh, 14), blend: "dest-in" }]).png().toBuffer();
  const lines = titleLines.map((l, i) => text(f800, l, 58, 80, 400 + i * 70, "#003057")).join("");
  const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e9eef6"/></linearGradient>
    <linearGradient id="bar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#E8338E"/><stop offset="1" stop-color="#8A2BE2"/></linearGradient>
    <filter id="s" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="18" stdDeviation="24" flood-color="#003057" flood-opacity="0.22"/></filter></defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <rect x="80" y="262" width="110" height="7" rx="3.5" fill="url(#bar)"/>
    ${text(f700, eyebrow, 20, 80, 318, "#737373", 0.16)}
    ${lines}
    ${text(f400, sub, 28, 80, 400 + titleLines.length * 70 + 20, "#4a5565")}
    ${text(f700, "americaneagle.com", 24, 80, 1120, "#003057")}
    <rect x="${W - sw - 60}" y="660" width="${sw}" height="${sh}" rx="14" fill="#fff" filter="url(#s)"/></svg>`;
  await sharp(Buffer.from(bg))
    .composite([
      { input: shot, left: W - sw - 60, top: 660 },
      { input: logo, left: 64, top: 90 },
    ])
    .jpeg({ quality: 88 })
    .toFile(path.join(out, name));
}

(async () => {
  for (const f of fs.readdirSync(raw).filter((f) => f.endsWith(".jpg"))) await frame(f);
  await cover("pg-cover-4x3.jpg", path.join(__dirname, "..", "public/branding/publish-guard-logo-512.png"), "HOW-TO · SITECOREAI MARKETPLACE",
    ["Audit SitecoreAI", "content before", "you publish"], "Publish Guard by AE, step by step", "pg-02-verdict.jpg");
  await cover("ct-cover-4x3.jpg", "/Users/tvallabh/sitecoreai-relay/public/branding/content-transfer-logo-512.png", "HOW-TO · SITECOREAI MARKETPLACE",
    ["Copy content", "between SitecoreAI", "environments"], "Content Transfer by AE, step by step", "ct-04-review.jpg");
  console.log(fs.readdirSync(out).join("\n"));
})();
