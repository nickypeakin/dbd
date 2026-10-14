// Builds a fully static copy of the game into dist/ for GitHub Pages (or any
// static host). In this build there is no game server: the host player's
// browser runs lobbies and matches, and friends connect to it peer-to-peer.
// Usage: npm run build

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');
const NM = path.join(ROOT, 'node_modules');

const copy = (src, dst) => {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
};

fs.rmSync(OUT, { recursive: true, force: true });

// game client, shared rules, and the server modules the browser host runs
copy(path.join(ROOT, 'public'), OUT);
copy(path.join(ROOT, 'shared'), path.join(OUT, 'shared'));
for (const f of fs.readdirSync(path.join(ROOT, 'server'))) {
  if (f.endsWith('.js') && f !== 'index.js') copy(path.join(ROOT, 'server', f), path.join(OUT, 'server', f));
}
copy(path.join(ROOT, 'server', 'bots'), path.join(OUT, 'server', 'bots'));

// three.js core plus only the addons the client imports (and what they import)
const threeDir = path.join(NM, 'three');
copy(path.join(threeDir, 'build', 'three.module.js'), path.join(OUT, 'vendor', 'three', 'build', 'three.module.js'));
const addonQueue = [];
const seen = new Set();
const scan = (file) => {
  for (const m of fs.readFileSync(file, 'utf8').matchAll(/from\s+['"]three\/addons\/([^'"]+)['"]/g)) addonQueue.push(m[1]);
};
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) scan(p);
  }
};
walk(path.join(OUT, 'js'));
while (addonQueue.length) {
  const rel = addonQueue.pop();
  if (seen.has(rel)) continue;
  seen.add(rel);
  const src = path.join(threeDir, 'examples', 'jsm', rel);
  copy(src, path.join(OUT, 'vendor', 'three', 'examples', 'jsm', rel));
  for (const m of fs.readFileSync(src, 'utf8').matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
    addonQueue.push(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
  }
}

// fonts: the stylesheets index.html links, and the font files they reference
const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
for (const m of html.matchAll(/href="vendor\/fonts\/([^"]+\.css)"/g)) {
  const css = path.join(NM, '@fontsource', m[1]);
  const dstCss = path.join(OUT, 'vendor', 'fonts', m[1]);
  copy(css, dstCss);
  for (const u of fs.readFileSync(css, 'utf8').matchAll(/url\((\.\/files\/[^)]+)\)/g)) {
    const src = path.join(path.dirname(css), u[1]);
    const dst = path.join(path.dirname(dstCss), u[1]);
    if (!fs.existsSync(dst)) copy(src, dst);
  }
}

// WebRTC helper used to connect friends
copy(path.join(NM, 'peerjs', 'dist', 'peerjs.min.js'), path.join(OUT, 'vendor', 'peerjs', 'peerjs.min.js'));

// Version the game's own files: browsers keep GitHub Pages files for up to 10
// minutes, so without this a reload after an update can run old code (or a
// mix of old and new modules). Every relative import gets ?v=<hash of the
// build>, which changes whenever any of these files does.
const walkFiles = (dir, ext, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, ext, out);
    else if (ext.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
};
const codeFiles = ['js', 'shared', 'server', 'css'].flatMap((d) => walkFiles(path.join(OUT, d), ['.js', '.css']));
const hash = crypto.createHash('sha1');
for (const f of codeFiles.sort()) hash.update(fs.readFileSync(f));
const version = hash.digest('hex').slice(0, 10);
const tag = (spec) => `${spec}?v=${version}`;
for (const f of codeFiles.filter((f) => f.endsWith('.js'))) {
  const src = fs.readFileSync(f, 'utf8')
    .replace(/((?:\bfrom|\bimport)\s*\(?\s*['"])(\.{1,2}\/[^'"?]+\.js)(['"])/g, (m, a, spec, b) => a + tag(spec) + b)
    .replace(/(new URL\(\s*['"])(\.{1,2}\/[^'"?]+\.js)(['"])/g, (m, a, spec, b) => a + tag(spec) + b);
  fs.writeFileSync(f, src);
}

// switch the client to browser-hosted multiplayer
let out = html.replace('<meta name="dbd-net" content="server">', '<meta name="dbd-net" content="p2p">');
if (out === html) throw new Error('index.html is missing the dbd-net meta tag');
out = out.replace('src="js/main.js"', `src="${tag('js/main.js')}"`).replace('href="css/style.css"', `href="${tag('css/style.css')}"`);
if (!out.includes(`?v=${version}"></script>`) || !out.includes(`style.css?v=${version}`)) throw new Error('could not version main.js or style.css in index.html');
fs.writeFileSync(path.join(OUT, 'index.html'), out);
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

let files = 0, bytes = 0;
const count = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) count(p);
    else { files++; bytes += fs.statSync(p).size; }
  }
};
count(OUT);
console.log(`Static build ${version} written to dist/ (${files} files, ${(bytes / 1e6).toFixed(1)} MB)`);
