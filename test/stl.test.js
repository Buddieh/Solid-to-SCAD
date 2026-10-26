import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSTL, indexMesh, openEdgeCount, bounds, volume } from '../src/core/index.js';
import { writeSTL } from '../src/core/index.js';
import { makeBox } from './model.js';

test('writes and reads back a binary STL as a closed solid', () => {
  const made = makeBox();
  const box = indexMesh(parseSTL(writeSTL(made)));
  assert.equal(box.faces.length, made.faces.length);
  assert.equal(box.points.length, made.points.length);
  assert.equal(openEdgeCount(box), 0);
  const [lo, hi] = bounds(box);
  assert.deepEqual(lo.map(v => +v.toFixed(3) + 0), [-17.5, -52.5, 0]);
  assert.deepEqual(hi.map(v => +v.toFixed(3) + 0), [17.5, 52.5, 30]);
  assert.ok(Math.abs(volume(box) - volume(made)) < 0.1);
});

test('reads ASCII STL', () => {
  const ascii = `solid t
facet normal 0 0 -1
 outer loop
  vertex 0 0 0
  vertex 1 0 0
  vertex 0 1 0
 endloop
endfacet
endsolid t`;
  const mesh = indexMesh(parseSTL(new TextEncoder().encode(ascii)));
  assert.equal(mesh.points.length, 9);
  assert.deepEqual(Array.from(mesh.faces), [0, 1, 2]);
});
