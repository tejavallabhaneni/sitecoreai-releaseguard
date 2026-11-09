/* eslint-disable @typescript-eslint/no-require-imports -- plain Node build script */
// Renders the PNGs from the SVGs written by build-logo.js. Needs `sharp` (npx --yes sharp-cli is not required; install sharp locally if missing).
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const b = (f) => path.join(__dirname, "..", "public/branding", f);
const logo = fs.readFileSync(b("releaseguard-logo.svg"));
const icon = fs.readFileSync(b("releaseguard-icon.svg"));
Promise.all([
  sharp(logo, { density: 300 }).resize(512, 512).png().toFile(b("releaseguard-logo-512.png")),
  sharp(logo, { density: 300 }).resize(1024, 1024).png().toFile(b("releaseguard-logo-1024.png")),
  sharp(icon, { density: 300 }).resize(256, 256).png().toFile(path.join(__dirname, "..", "src/app/icon.png")),
  sharp(icon, { density: 300 }).resize(180, 180).png().toFile(path.join(__dirname, "..", "src/app/apple-icon.png")),
]).then(() => console.log("rendered"));
