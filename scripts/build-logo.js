/* eslint-disable @typescript-eslint/no-require-imports -- plain Node build script */
const fs = require("fs");
const path = require("path");
/**
 * Generates the Publish Guard brand artwork into public/branding/:
 *   publish-guard-logo.svg  512 white tile: halftone shield + check, "Publish" navy / "Guard" gradient
 *   publish-guard-mark.svg  the shield alone, transparent (header lockup)
 *   publish-guard-icon.svg  the shield on white with a coarser dot grid (favicons, small sizes)
 * Same family as Content Transfer: halftone dots in the pink -> purple gradient,
 * Libre Franklin ExtraBold wordmark converted to outlines.
 *
 *   node scripts/build-logo.js && node scripts/render-logo.js
 */
const root = path.join(__dirname, "..");
const outDir = path.join(root, "public/branding");
const opentype = require("opentype.js");
const font800 = opentype.loadSync(require.resolve("@fontsource/libre-franklin/files/libre-franklin-latin-800-normal.woff"));

const PINK = "#E8338E", PURPLE = "#8A2BE2", NAVY = "#003057";

// Shield outline as a polygon (sampled cubic beziers), in a 240x276 box at origin.
function cubic(p0, p1, p2, p3, n = 24) {
  const pts = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push([
      u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0],
      u*u*u*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t*t*t*p3[1],
    ]);
  }
  return pts;
}
const W = 240, H = 276, cx = W / 2;
const shield = [[cx, 0]];
shield.push(...cubic([cx, 0], [cx + 40, 18], [cx + 80, 30], [W, 36]));
shield.push(...cubic([W, 36], [W, 36], [W, 120], [W, 128]));
shield.push(...cubic([W, 128], [W, 200], [cx + 60, 250], [cx, H]));
shield.push(...cubic([cx, H], [cx - 60, 250], [0, 200], [0, 128]));
shield.push(...cubic([0, 128], [0, 120], [0, 36], [0, 36]));
shield.push(...cubic([0, 36], [cx - 80, 30], [cx - 40, 18], [cx, 0]));

function inside([x, y], poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function segDist([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, L = dx*dx + dy*dy;
  if (L === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px-ax)*dx + (py-ay)*dy) / L));
  return Math.hypot(px - (ax + t*dx), py - (ay + t*dy));
}
const edgeDist = (p) => Math.min(...shield.map((a, i) => segDist(p, a, shield[(i + 1) % shield.length])));

// Check mark (in shield coords) and its knock-out halo.
const check = [[70, 146], [106, 182], [176, 106]];
const checkStroke = 26, halo = 15;
const distToCheck = (p) => Math.min(segDist(p, check[0], check[1]), segDist(p, check[1], check[2]));

function mark(ox, oy, scale = 1, step = 15, rMax = 6.1) {
  const dots = [];
  for (let y = step / 2; y < H; y += step) {
    for (let x = step / 2; x < W; x += step) {
      const p = [x, y];
      if (!inside(p, shield)) continue;
      const d = edgeDist(p);
      if (d < 2.5) continue;
      const k = Math.min(1, d / 58);
      let r = rMax * (0.26 + 0.74 * Math.pow(k, 0.85));
      const dc = distToCheck(p) - checkStroke / 2;
      if (dc < halo * 0.45) continue;
      if (dc < halo * 1.6) r *= 0.55 + 0.45 * ((dc - halo * 0.45) / (halo * 1.15));
      dots.push(`<circle cx="${(ox + x*scale).toFixed(1)}" cy="${(oy + y*scale).toFixed(1)}" r="${(r*scale).toFixed(2)}"/>`);
    }
  }
  const pts = check.map(([x, y]) => `${(ox + x*scale).toFixed(1)} ${(oy + y*scale).toFixed(1)}`);
  return `
  <g fill="url(#rgDots)">${dots.join("")}</g>
  <path d="M${pts[0]} L${pts[1]} L${pts[2]}" fill="none" stroke="url(#rgCheck)" stroke-width="${checkStroke*scale}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function defs(ox, oy, scale = 1) {
  const x1 = ox, x2 = ox + W*scale, y1 = oy, y2 = oy + H*scale;
  return `<defs>
    <linearGradient id="rgDots" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${PINK}"/><stop offset="1" stop-color="${PURPLE}"/></linearGradient>
    <linearGradient id="rgCheck" x1="${ox + 62*scale}" y1="${oy + 184*scale}" x2="${ox + 186*scale}" y2="${oy + 98*scale}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${PINK}"/><stop offset="1" stop-color="${PURPLE}"/></linearGradient>
    <linearGradient id="rgWord" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${PINK}"/><stop offset="1" stop-color="${PURPLE}"/></linearGradient>
  </defs>`;
}

function word(text, size) {
  const p = font800.getPath(text, 0, 0, size);
  const bb = p.getBoundingBox();
  return { d: p.toPathData(2), width: font800.getAdvanceWidth(text, size), bb };
}

// 1) Full logo: white 512 tile, mark on top, wordmark below (Content Transfer layout).
{
  const size = 54;
  const a = word("Publish ", size), b = word("Guard", size);
  const total = a.width + b.width;
  const scale = 0.92;
  const mx = (512 - W*scale) / 2, my = 84;
  const baseline = 422;
  const sx = (512 - total) / 2;
  const ra = font800.getPath("Publish", sx, baseline, size).toPathData(2);
  const gb = font800.getPath("Guard", sx + a.width, baseline, size);
  const gbb = gb.getBoundingBox();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Publish Guard">
  <title>Publish Guard</title>
  ${defs(mx, my, scale).replace('id="rgWord" x1="0" y1="0" x2="1" y2="0"', `id="rgWord" x1="${gbb.x1.toFixed(1)}" y1="0" x2="${gbb.x2.toFixed(1)}" y2="0" gradientUnits="userSpaceOnUse"`)}
  <rect width="512" height="512" fill="#fff"/>
  ${mark(mx, my, scale)}
  <path d="${ra}" fill="${NAVY}"/>
  <path d="${gb.toPathData(2)}" fill="url(#rgWord)"/>
</svg>`;
  fs.writeFileSync(path.join(outDir, "publish-guard-logo.svg"), svg);
}

// 2) Mark only, tight viewBox, transparent.
{
  const pad = 6;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${W + pad*2} ${H + pad*2}" role="img" aria-label="Publish Guard">
  <title>Publish Guard</title>
  ${defs(0, 0, 1)}
  ${mark(0, 0, 1)}
</svg>`;
  fs.writeFileSync(path.join(outDir, "publish-guard-mark.svg"), svg);
}

// 3) Square icon: mark centered on white (favicon / apple icon).
{
  const scale = 1.55, mx = (512 - W*scale) / 2, my = (512 - H*scale) / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="0" fill="#fff"/>${defs(mx, my, scale)}${mark(mx, my, scale, 22, 9)}</svg>`;
  fs.writeFileSync(path.join(outDir, "publish-guard-icon.svg"), svg);
}
console.log("ok");
