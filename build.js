'use strict';

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
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
