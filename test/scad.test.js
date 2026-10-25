import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simplifyMesh, suggestModel, exportScad, parseSTL, indexMesh, bounds, openEdgeCount } from '../src/core/index.js';
import { load } from './helpers.js';

const parts = [
  { name: 'box', mesh: await simplifyMesh(load('box.stl')) },
  { name: 'lid', mesh: await simplifyMesh(load('lid.stl')) },
];
const { params } = suggestModel(parts);
const scad = exportScad({ title: 'Container', parts, params });

test('writes Customizer sections and parameters', () => {
  assert.match(scad, /^\/\* \[Size\] \*\/$/m);
  assert.match(scad, /^width = 35; \/\/ \[[\d.]+:0\.5:256\]$/m);
  assert.match(scad, /^part = "all"; \/\/ \[all, box, lid\]$/m);
  assert.match(scad, /^\/\* \[Hidden\] \*\/$/m);
  assert.ok(scad.length < 100 * 1024, `file is ${scad.length} bytes`);
});

test('rejects a minimum that would collapse a zone', () => {
  const bad = params.map(p => ({ ...p, min: p.name === 'width' ? 1 : p.min }));
  assert.throws(() => exportScad({ parts, params: bad }), /collapses/);
});

let openscad = null;
try { execFileSync('openscad', ['--version'], { stdio: 'ignore' }); openscad = 'openscad'; } catch {}

test('renders in OpenSCAD at several sizes', { skip: !openscad && 'openscad not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'stl2scad-'));
  const file = join(dir, 'model.scad');
  writeFileSync(file, scad);
  for (const [part, w, l, h] of [['box', 50, 136.5, 40], ['lid', 20, 40, 20], ['box', 200, 250, 150]]) {
    const out = join(dir, `${part}.stl`);
    execFileSync(openscad, ['-o', out, '-D', `part="${part}"`, '-D', `width=${w}`, '-D', `length=${l}`,
      '-D', `height=${h}`, file], { stdio: 'pipe' });
    const mesh = indexMesh(parseSTL(readFileSync(out)));
    assert.equal(openEdgeCount(mesh), 0);
    const [lo, hi] = bounds(mesh);
    assert.ok(Math.abs(hi[1] - lo[1] - l) < 0.01, `${part} length`);
    if (part === 'box') {
      assert.ok(Math.abs(hi[0] - lo[0] - w) < 0.01, 'box width');
      assert.ok(Math.abs(hi[2] - lo[2] - h) < 0.01, 'box height');
    }
  }
});

test('a single part exports without a part selector', { skip: !openscad && 'openscad not installed' }, () => {
  const one = [parts[0]];
  const { params: p1 } = suggestModel(one);
  const text = exportScad({ parts: one, params: p1 });
  assert.doesNotMatch(text, /^part = /m);
  const dir = mkdtempSync(join(tmpdir(), 'stl2scad-'));
  writeFileSync(join(dir, 'one.scad'), text);
  execFileSync(openscad, ['-o', join(dir, 'one.stl'), '-D', 'width=60', join(dir, 'one.scad')], { stdio: 'pipe' });
  const [lo, hi] = bounds(indexMesh(parseSTL(readFileSync(join(dir, 'one.stl')))));
  assert.ok(Math.abs(hi[0] - lo[0] - 60) < 0.01);
});
