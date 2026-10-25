// Turn a set of parts into suggested size parameters (the starting point the UI lets you edit).

import { bounds } from './stl.js';
import { suggestZone } from './analyze.js';

const NAMES = ['width', 'length', 'height'];
const LABELS = ['Outer width (X), mm', 'Outer length (Y), mm', 'Height (Z), mm'];

/**
 * Parts that should move together on an axis: centred within 1 mm of the reference part and
 * covering most of its span (e.g. a lid on a box). The reference part is always included.
 */
function linkedParts(parts, axis) {
  const [rlo, rhi] = bounds(parts[0].mesh).map(v => v[axis]);
  return parts.filter((p, i) => {
    if (i === 0) return true;
    const [lo, hi] = bounds(p.mesh).map(v => v[axis]);
    return Math.abs((lo + hi) / 2 - (rlo + rhi) / 2) < 1 && (hi - lo) > 0.8 * (rhi - rlo);
  });
}

/**
 * @param {{name: string, mesh: {points: Float64Array, faces: Uint32Array}}[]} parts  first is the reference
 * @param {{step?: number, maxSize?: number}} [opts]
 * @returns {{params: object[], skipped: {axis: number, reason: string}[]}}
 */
export function suggestModel(parts, { step = 0.5, maxSize = 256 } = {}) {
  const params = [];
  const skipped = [];
  const [lo, hi] = bounds(parts[0].mesh);
  for (const axis of [0, 1, 2]) {
    // Height usually belongs to one part only (a lid keeps its thickness).
    const linked = axis === 2 ? [parts[0]] : linkedParts(parts, axis);
    const zone = suggestZone(linked.map(p => p.mesh), axis);
    if (!zone) {
      skipped.push({ axis, reason: 'no straight section to stretch' });
      continue;
    }
    const base = hi[axis] - lo[axis];
    const span = zone.b - zone.a;
    const min = Math.ceil((base - 0.8 * span) / step) * step;
    params.push({
      name: NAMES[axis],
      label: LABELS[axis],
      zone: { axis, a: zone.a, b: zone.b, anchor: zone.anchor },
      base: Math.round(base * 1000) / 1000,
      min: Math.max(step, min),
      max: Math.max(maxSize, Math.ceil(base)),
      step,
      parts: linked.map(p => p.name),
      ranges: zone.ranges,
    });
  }
  return { params, skipped };
}
