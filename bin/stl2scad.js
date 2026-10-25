#!/usr/bin/env node
// Command-line version of the pipeline: STL files in, one parametric .scad out.
// The first file is the reference part (its size is what the parameters describe).
//
//   stl2scad box.stl lid.stl -o container.scad [--title "My box"] [--tolerance 0.001] [--no-simplify]

import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseSTL, indexMesh, openEdgeCount, simplifyMesh, suggestModel, exportScad } from '../src/core/index.js';

const args = process.argv.slice(2);
const files = [];
let out = 'model.scad', title, tolerance = 0.001, simplify = true;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '-o') out = args[++i];
  else if (a === '--title') title = args[++i];
  else if (a === '--tolerance') tolerance = +args[++i];
  else if (a === '--no-simplify') simplify = false;
  else files.push(a);
}
if (!files.length) {
  console.error('usage: stl2scad part1.stl [part2.stl ...] -o out.scad');
  process.exit(1);
}

const used = new Set();
const parts = [];
for (const f of files) {
  let mesh = indexMesh(parseSTL(readFileSync(f)));
  const open = openEdgeCount(mesh);
  if (open) console.warn(`${f}: ${open} open edges, the mesh is not watertight`);
  if (simplify) mesh = await simplifyMesh(mesh, tolerance);
  let name = basename(f).replace(/\.stl$/i, '').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^(\d)/, '_$1').toLowerCase();
  while (used.has(name)) name += '_';
  used.add(name);
  parts.push({ name, mesh });
}

const { params, skipped } = suggestModel(parts);
for (const p of params) {
  console.log(`${p.name}: zone ${p.zone.a} .. ${p.zone.b} (anchor ${p.zone.anchor}), base ${p.base}, ` +
    `range ${p.min}..${p.max}, parts ${p.parts.join(', ')}`);
}
for (const s of skipped) console.log(`axis ${'XYZ'[s.axis]} skipped: ${s.reason}`);
const scad = exportScad({ title: title || basename(files[0]), parts, params });
writeFileSync(out, scad);
console.log(`wrote ${out} (${(scad.length / 1024).toFixed(0)} KB)`);
