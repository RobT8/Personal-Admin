// Bundles src/ into a single self-contained PersonalAdmin.html (works offline from a double-click).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const src = resolve(root, 'src');
let html = readFileSync(resolve(src, 'index.html'), 'utf8');

// Keep inline scripts from closing the <script> element early.
const safeJs = (js) => js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, f) => `<style>\n${readFileSync(resolve(src, f), 'utf8')}</style>`);
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, f) => `<script>\n${safeJs(readFileSync(resolve(src, f), 'utf8'))}\n</script>`);
// Everything is inline now, so the page needs no 'self' sources at all.
html = html.replace(/ 'self'/g, '');

const out = resolve(root, 'PersonalAdmin.html');
writeFileSync(out, html);
console.log(`Wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
