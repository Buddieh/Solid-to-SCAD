#!/usr/bin/env node
// Assemble the static web app into _site/ (what GitHub Pages serves). No bundler: the app is
// plain ES modules, so this only copies files and the two libraries it needs from node_modules.

import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

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
cpSync(join(root, 'test/fixtures/box.stl'), join(out, 'samples/container-box.stl'));
cpSync(join(root, 'test/fixtures/lid.stl'), join(out, 'samples/container-lid.stl'));
console.log(`built ${out}`);
