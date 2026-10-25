#!/usr/bin/env node
// Assemble the static web app into _site/ (what GitHub Pages serves). No bundler: the app is
// plain ES modules, so this only copies files and the two libraries it needs from node_modules.

import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, dirname, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, process.argv[2] || '_site');
const nm = join(root, 'node_modules');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, 'web'), out, { recursive: true });
cpSync(join(root, 'src'), join(out, 'src'), { recursive: true });

mkdirSync(join(out, 'vendor/three/addons/controls'), { recursive: true });
cpSync(join(nm, 'three/build/three.module.js'), join(out, 'vendor/three/three.module.js'));
cpSync(join(nm, 'three/examples/jsm/controls/OrbitControls.js'), join(out, 'vendor/three/addons/controls/OrbitControls.js'));
cpSync(join(nm, 'three/LICENSE'), join(out, 'vendor/three/LICENSE'));
mkdirSync(join(out, 'vendor/manifold'), { recursive: true });
for (const f of ['manifold.js', 'manifold.wasm', 'LICENSE']) {
  cpSync(join(nm, 'manifold-3d', f), join(out, 'vendor/manifold', f));
}

mkdirSync(join(out, 'samples'), { recursive: true });
for (const f of ['box.stl', 'lid.stl', 'box_width_50.stl', 'lid_width_50.stl', 'box_length_136.5.stl',
  'lid_length_136.5.stl', 'box_height_40.stl']) {
  cpSync(join(root, 'test/fixtures', f), join(out, 'samples', f));
}
// Stamp the app's own files with a content hash, so a browser never mixes a cached old file
// with new ones after a deploy (GitHub Pages lets browsers cache for 10 minutes).
const files = dir => readdirSync(dir, { withFileTypes: true })
  .flatMap(e => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
const appFiles = files(out).filter(f => /\.(js|css|html)$/.test(f) && !relative(out, f).startsWith('vendor'));
const hash = createHash('sha256');
for (const f of appFiles.sort()) hash.update(relative(out, f)).update(readFileSync(f));
const v = hash.digest('hex').slice(0, 10);
for (const f of appFiles) {
  const text = readFileSync(f, 'utf8');
  const stamped = f.endsWith('.html')
    ? text.replace(/(href|src)="((?!https?:|\/\/)[^"]+\.(?:css|js))"/g, `$1="$2?v=${v}"`)
    : text.replace(/((?:from|import)\s*\(?\s*|new URL\(\s*)(['"])(\.{1,2}\/[^'"]+\.js)\2/g, `$1$2$3?v=${v}$2`);
  if (stamped !== text) writeFileSync(f, stamped);
}
console.log(`built ${out} (version ${v})`);
