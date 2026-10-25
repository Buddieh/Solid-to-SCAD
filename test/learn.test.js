// Learning a parameter from two exports of the same model.
// box.stl / lid.stl are CAD exports at 35 x 105 x 30. box_50x136.5x40.stl is the CAD program's own export
// with all three values changed. The single-value variants (box_width_50.stl, ...) change one
// value each and were made with the zone stretch that matches the CAD export (see cad.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  simplifyMesh, learnChange, applyChanges, safeRange, exportLearnedScad, meshDeviation,
  parseSTL, indexMesh, openEdgeCount,
} from '../src/core/index.js';
import { load } from './helpers.js';

const box = await simplifyMesh(load('box.stl'));
const lid = await simplifyMesh(load('lid.stl'));
const cadBox = load('box_50x136.5x40.stl');
const cadLid = load('lid_50x136.5.stl');

const params = [
  { name: 'width', base: 35, variant: 50 },
  { name: 'length', base: 105, variant: 136.5 },
  { name: 'height', base: 30, variant: 40 },
];
const learned = { box: {}, lid: {} };
for (const p of params) {
  learned.box[p.name] = learnChange(box, load(`box_${p.name}_${p.variant}.stl`));
  if (p.name !== 'height') learned.lid[p.name] = learnChange(lid, load(`lid_${p.name}_${p.variant}.stl`));
}

test('learns a change from the CAD program\'s own resized export', () => {
  const l = learnChange(box, cadBox);
  assert.ok(l.fit.max < 0.02, `fit ${l.fit.max}`);
  for (let k = 0; k < 3; k++) {
    const moved = l.tables[k].map((t, i) => t + l.delta[k][i]);
    for (let i = 1; i < moved.length; i++) assert.ok(moved[i] > moved[i - 1], `axis ${k} stays in order`);
  }
  const [lo, hi] = safeRange(l.tables, l.delta);
  assert.ok(lo < -1 && lo > -3, `shrinks to about a third: ${lo}`);
  assert.ok(hi > 10, `grows freely: ${hi}`);
});

test('every single-value change fits closely', () => {
  for (const part of ['box', 'lid']) {
    for (const [name, l] of Object.entries(learned[part])) assert.ok(l.fit.max < 0.02, `${part} ${name}: ${l.fit.max}`);
  }
});

test('changes learned one at a time combine into the CAD export', () => {
  for (const [part, mesh, cad] of [['box', box, cadBox], ['lid', lid, cadLid]]) {
    const ls = Object.values(learned[part]);
    const moved = applyChanges(mesh, ls[0], ls.map(() => 1), ls.map(l => l.delta));
    const dev = meshDeviation(moved, cad);
    assert.ok(dev.max < 0.05, `${part}: ${dev.max}`);
  }
});

test('a change in how many parts there are does not fit', () => {
  const n = box.points.length / 3;
  const two = { points: new Float64Array(n * 6), faces: new Uint32Array(box.faces.length * 2) };
  two.points.set(box.points);
  for (let i = 0; i < n; i++) {
    two.points[(n + i) * 3] = box.points[i * 3] + 45;
    two.points[(n + i) * 3 + 1] = box.points[i * 3 + 1];
    two.points[(n + i) * 3 + 2] = box.points[i * 3 + 2];
  }
  two.faces.set(box.faces);
  for (let i = 0; i < box.faces.length; i++) two.faces[box.faces.length + i] = box.faces[i] + n;
  const l = learnChange(box, two, { iterations: 6 });
  assert.ok(l.fit.max > 0.5, `fit ${l.fit.max}`);
});

const scadParams = params.map(p => ({ ...p, min: p.base - 10, max: p.base + 30, step: 0.5 }));
const scad = exportLearnedScad({
  title: 'Container',
  params: scadParams,
  parts: [
    { name: 'box', mesh: box, ...learned.box.width, deltas: Object.fromEntries(Object.entries(learned.box).map(([k, l]) => [k, l.delta])) },
    { name: 'lid', mesh: lid, ...learned.lid.width, deltas: Object.fromEntries(Object.entries(learned.lid).map(([k, l]) => [k, l.delta])) },
  ],
});

test('writes a Customizer slider for each value', () => {
  assert.match(scad, /^\/\* \[Parameters\] \*\/$/m);
  assert.match(scad, /^width = 35; \/\/ \[25:0\.5:65\]$/m);
  assert.match(scad, /^part = "all"; \/\/ \[all, box, lid\]$/m);
  assert.doesNotMatch(scad, /lid_z_height/, 'height does not move the lid');
  assert.ok(scad.length < 100 * 1024, `file is ${scad.length} bytes`);
});

let openscad = null;
try { execFileSync('openscad', ['--version'], { stdio: 'ignore' }); openscad = 'openscad'; } catch {}

test('OpenSCAD renders the learned model at the CAD export\'s sizes', { skip: !openscad && 'openscad not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'learned-'));
  const file = join(dir, 'model.scad');
  writeFileSync(file, scad);
  for (const [part, cad] of [['box', cadBox], ['lid', cadLid]]) {
    const out = join(dir, `${part}.stl`);
    execFileSync(openscad, ['-o', out, '-D', `part="${part}"`, '-D', 'width=50', '-D', 'length=136.5', '-D', 'height=40', file], { stdio: 'pipe' });
    const mesh = indexMesh(parseSTL(readFileSync(out)));
    assert.equal(openEdgeCount(mesh), 0, `${part} is watertight`);
    const dev = meshDeviation(mesh, cad);
    assert.ok(dev.max < 0.05, `${part}: ${dev.max}`);
  }
});
