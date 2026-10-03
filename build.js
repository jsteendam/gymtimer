'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = __dirname;
const outDir = path.join(root, 'dist');

async function build() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

  const minifiedCss = (await esbuild.transform(css, { loader: 'css', minify: true })).code;
  const minifiedJs = (await esbuild.transform(js, { loader: 'js', minify: true })).code;

  const inlined = html
    .replace('<link rel="stylesheet" href="style.css">', `<style>${minifiedCss}</style>`)
    .replace('<script src="app.js" defer></script>', `<script>${minifiedJs}</script>`);

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), inlined);

  console.log(`Built dist/index.html (${(inlined.length / 1024).toFixed(1)} KB)`);

  // PWA: manifest + icons copied as-is, service worker versioned by content hash
  const iconFiles = fs.readdirSync(path.join(root, 'icons')).map((f) => `icons/${f}`);
  const assets = ['manifest.webmanifest', ...iconFiles];
  fs.mkdirSync(path.join(outDir, 'icons'), { recursive: true });
  const hash = crypto.createHash('sha256').update(inlined);
  for (const file of assets) {
    const data = fs.readFileSync(path.join(root, file));
    hash.update(data);
    fs.writeFileSync(path.join(outDir, file), data);
  }

  const precache = ['./', './index.html', ...assets.map((f) => `./${f}`)];
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8')
    .replace('__BUILD_HASH__', hash.digest('hex').slice(0, 12))
    .replace(/const PRECACHE = \[[\s\S]*?\];/, `const PRECACHE = ${JSON.stringify(precache)};`);
  const minifiedSw = (await esbuild.transform(sw, { loader: 'js', minify: true })).code;
  fs.writeFileSync(path.join(outDir, 'sw.js'), minifiedSw);

  console.log(`Built dist/sw.js, copied ${assets.join(', ')}`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
