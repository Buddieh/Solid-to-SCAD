import test from 'node:test';
import assert from 'node:assert/strict';
import { mapValue, minDelta } from '../src/core/index.js';

const zone = { axis: 0, a: -10, b: 10, anchor: 0.5 };

test('ends move by half the change each, centre stays', () => {
  assert.equal(mapValue(-20, zone, 6), -23);
  assert.equal(mapValue(20, zone, 6), 23);
  assert.equal(mapValue(0, zone, 6), 0);
});

test('map is continuous at the zone edges', () => {
  for (const d of [-15, -5, 0, 7, 40]) {
    assert.ok(Math.abs(mapValue(10 - 1e-9, zone, d) - mapValue(10 + 1e-9, zone, d)) < 1e-6);
    assert.ok(Math.abs(mapValue(-10 - 1e-9, zone, d) - mapValue(-10 + 1e-9, zone, d)) < 1e-6);
  }
});

test('map stays increasing while shrinking down to the limit', () => {
  const d = minDelta(zone) * 0.95;
  let prev = -Infinity;
  for (let t = -30; t <= 30; t += 0.25) {
    const v = mapValue(t, zone, d);
    assert.ok(v > prev);
    prev = v;
  }
});

test('anchor 0 keeps the low end fixed', () => {
  const z = { axis: 2, a: 8, b: 25, anchor: 0 };
  assert.equal(mapValue(0, z, 10), 0);
  assert.equal(mapValue(30, z, 10), 40);
});
