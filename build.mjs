// Builds two things from src/:
//   PersonalAdmin.html — one self-contained file for desktop (double-click, works offline from file://)
//   site/              — the installable phone app (PWA) published to GitHub Pages
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const src = resolve(root, 'src');
const read = (f) => readFileSync(resolve(src, f), 'utf8');

// Keep inline scripts from closing the <script> element early.
const safeJs = (js) => js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

let inlined = read('index.html');
inlined = inlined.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, f) => `<style>\n${read(f)}</style>`);
inlined = inlined.replace(/<script src="([^"]+)"><\/script>/g, (_, f) => `<script>\n${safeJs(read(f))}\n</script>`);

/* ---------- desktop single file ---------- */
// No server, so: no manifest, no service worker, and no 'self' sources at all.
const desktop = inlined
  .replace(/\s*<!-- pwa:start -->[\s\S]*?<!-- pwa:end -->/, '')
  .replace("manifest-src 'self'", "manifest-src 'none'")
  .replace(/ 'self'/g, '');
writeFileSync(resolve(root, 'PersonalAdmin.html'), desktop);
console.log(`PersonalAdmin.html  ${(desktop.length / 1024).toFixed(0)} KB`);

/* ---------- phone app site ---------- */
// Scripts and styles stay inline; only the manifest, icons and service worker load from the site.
const site = inlined
  .replace("script-src 'unsafe-inline' 'self' blob:", "script-src 'unsafe-inline' blob:")
  .replace("style-src 'unsafe-inline' 'self'", "style-src 'unsafe-inline'");
const out = resolve(root, 'site');
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
writeFileSync(resolve(out, 'index.html'), site);
writeFileSync(resolve(out, '.nojekyll'), '');
copyFileSync(resolve(src, 'manifest.webmanifest'), resolve(out, 'manifest.webmanifest'));
for (const f of ['core.js', 'db.js']) copyFileSync(resolve(src, f), resolve(out, f));
const icons = ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
for (const f of icons) copyFileSync(resolve(src, 'icons', f), resolve(out, f));

const assets = ['./', 'index.html', 'manifest.webmanifest', 'core.js', 'db.js', ...icons];
const version = createHash('sha256').update(site + read('manifest.webmanifest') + read('sw.js')).digest('hex').slice(0, 12);
writeFileSync(resolve(out, 'sw.js'), read('sw.js').replace('__VERSION__', version).replace('__ASSETS__', JSON.stringify(assets)));
console.log(`site/               version ${version}`);
