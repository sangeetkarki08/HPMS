/*
  Builds the static web bundle into ./www for Capacitor.
  Zero dependencies — plain Node fs. Run via `npm run build:web`.

  Capacitor copies `webDir` into the native Android/iOS projects,
  so we keep it limited to the actual app assets (no node_modules,
  no electron/, no build output).
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'www');

const ASSETS = [
  'index.html',
  'cpms.html',
  'config.js',
  'sw.js',
  'manifest.webmanifest',
  'app',   // directory (cloud-sync.js, icon.svg)
  'vendor' // directory (chart.js, bootstrap-icons + fonts)
];

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

rmrf(OUT);
fs.mkdirSync(OUT, { recursive: true });

let copied = 0;
for (const asset of ASSETS) {
  const src = path.join(ROOT, asset);
  if (!fs.existsSync(src)) {
    console.warn('[build-web] skip (not found):', asset);
    continue;
  }
  copyRecursive(src, path.join(OUT, asset));
  copied++;
}

console.log(`[build-web] copied ${copied} assets into ./www`);
