// The sample box and lid were also exported from the CAD program at 50 x 136.5 x 40. Stretching the
// originals with the suggested zones must reproduce those exports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { simplifyMesh, suggestModel, stretchMesh, bounds, volume, openEdgeCount } from '../src/core/index.js';
import { load, maxVertexDistance } from './helpers.js';

const parts = [
  { name: 'box', mesh: await simplifyMesh(load('box.stl')) },
  { name: 'lid', mesh: await simplifyMesh(load('lid.stl')) },
];
const { params } = suggestModel(parts);
const byName = Object.fromEntries(params.map(p => [p.name, p]));
const target = { width: 50, length: 136.5, height: 40 };

test('simplifying keeps the shape and cuts the size', () => {
  assert.ok(parts[0].mesh.faces.length / 3 < 2000);
  assert.ok(parts[1].mesh.faces.length / 3 < 1000);
  assert.equal(openEdgeCount(parts[0].mesh), 0);
  assert.ok(Math.abs(volume(parts[0].mesh) - volume(load('box.stl'))) < 0.5);
});

test('suggests width, length and height with the lid linked on width and length', () => {
  assert.deepEqual(params.map(p => p.name), ['width', 'length', 'height']);
  assert.deepEqual(byName.width.parts, ['box', 'lid']);
  assert.deepEqual(byName.length.parts, ['box', 'lid']);
  assert.deepEqual(byName.height.parts, ['box']);
  assert.equal(byName.height.zone.anchor, 0);
});

for (const [name, fixture] of [['box', 'box_50x136.5x40.stl'], ['lid', 'lid_50x136.5.stl']]) {
  test(`${name} stretched to 50 x 136.5 x 40 matches the CAD export`, () => {
    const part = parts.find(p => p.name === name);
    const changes = params.filter(p => p.parts.includes(name))
      .map(p => ({ zone: p.zone, d: target[p.name] - p.base }));
    const ours = stretchMesh(part.mesh, changes);
    const cad = load(fixture);
    const [ol, oh] = bounds(ours), [rl, rh] = bounds(cad);
    for (let a = 0; a < 3; a++) {
      assert.ok(Math.abs(ol[a] - rl[a]) < 0.01 && Math.abs(oh[a] - rh[a]) < 0.01, `bounds on axis ${a}`);
    }
    assert.ok(Math.abs(volume(ours) / volume(cad) - 1) < 0.001, 'volume within 0.1%');
    const dev = Math.max(maxVertexDistance(ours, cad), maxVertexDistance(cad, ours));
    assert.ok(dev < 0.03, `max deviation ${dev.toFixed(4)} mm`);
  });
}
