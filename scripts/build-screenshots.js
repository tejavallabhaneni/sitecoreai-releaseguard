/* eslint-disable @typescript-eslint/no-require-imports -- plain Node build script */
/**
 * Frames raw app captures (marketplace/raw/*.jpg) as 1800x1200 Marketplace screenshots:
 * caption in Libre Franklin ExtraBold navy, eyebrow in AE gray, the capture in a rounded card.
 *   NODE_PATH=<dir with sharp> node scripts/build-screenshots.js
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const opentype = require("opentype.js");
const font800 = opentype.loadSync(require.resolve("@fontsource/libre-franklin/files/libre-franklin-latin-800-normal.woff"));
const font700 = opentype.loadSync(require.resolve("@fontsource/libre-franklin/files/libre-franklin-latin-700-normal.woff"));

const root = path.join(__dirname, "..", "marketplace");
const shots = [
  ["1-release-verdict", "A release verdict for the whole site"],
  ["2-image-descriptions", "Catch images with no alt text"],
  ["3-links-and-references", "Find broken links and dead references"],
  ["4-languages", "Spot missing and untranslated languages"],
  ["5-publishing", "Stop unapproved and broken pages shipping"],
  ["6-audit-setup", "Audit any site, subtree and language set"],
];
const W = 1800, H = 1200;

function centered(font, text, size, y, fill, letterSpacing = 0) {
  const width = font.getAdvanceWidth(text, size, { letterSpacing });
  const p = font.getPath(text, (W - width) / 2, y, size, { letterSpacing });
  return `<path d="${p.toPathData(2)}" fill="${fill}"/>`;
}

(async () => {
  fs.mkdirSync(path.join(root, "screenshots"), { recursive: true });
  for (const [name, caption] of shots) {
    const raw = path.join(root, "raw", `${name}.jpg`);
    const meta = await sharp(raw).metadata();
    const cw = 1640, ch = Math.round((cw * meta.height) / meta.width);
    const x = (W - cw) / 2, y = 250;
    const radius = 14;
    const shot = await sharp(raw)
      .resize(cw, ch)
      .composite([{ input: Buffer.from(`<svg width="${cw}" height="${ch}"><rect width="${cw}" height="${ch}" rx="${radius}" fill="#fff"/></svg>`), blend: "dest-in" }])
      .png()
      .toBuffer();
    const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#eef2f7"/></linearGradient>
    <linearGradient id="bar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#E8338E"/><stop offset="1" stop-color="#8A2BE2"/></linearGradient>
    <filter id="s" x="-5%" y="-5%" width="110%" height="115%"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#003057" flood-opacity="0.18"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect x="${(W - 120) / 2}" y="48" width="120" height="6" rx="3" fill="url(#bar)"/>
  ${centered(font700, "PUBLISH GUARD BY AMERICANEAGLE.COM", 22, 108, "#737373", 0.16)}
  ${centered(font800, caption, 64, 192, "#003057")}
  <rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="${radius}" fill="#fff" filter="url(#s)"/>
</svg>`;
    await sharp(Buffer.from(bg))
      .composite([{ input: shot, left: x, top: y }])
      .jpeg({ quality: 90 })
      .toFile(path.join(root, "screenshots", `${name}.jpg`));
    console.log(name, cw, ch);
  }
})();
