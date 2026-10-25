// Find where a mesh can be stretched along an axis, and suggest a zone.
//
// A position t on an axis is a clean cut when every triangle that crosses t is parallel to the
// axis (its normal has no component along it). Then the surface is locally constant along the
// axis, and moving the two sides apart only lengthens those triangles without changing the shape.
// Triangles that tilt along the axis (end walls, fillet corners, tapers) block the range they span.

import { bounds } from './stl.js';

const AXES = ['x', 'y', 'z'];

/**
 * Ranges on `axis` where a cut is clean for every mesh given (linked parts must share a cut).
 * @param {{points: Float64Array, faces: Uint32Array}[]} meshes
 * @param {0|1|2} axis
 * @returns {{lo: number, hi: number}[]} sorted, non-overlapping
 */
export function cleanRanges(meshes, axis, { tol = 1e-3, minLength = 0.2 } = {}) {
  const blocked = [];
  let lo = Infinity, hi = -Infinity;
  for (const mesh of meshes) {
    const [bl, bh] = bounds(mesh);
    lo = Math.min(lo, bl[axis]);
    hi = Math.max(hi, bh[axis]);
    const { points: p, faces: f } = mesh;
    for (let i = 0; i < f.length; i += 3) {
      const a = f[i] * 3, b = f[i + 1] * 3, c = f[i + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const len = Math.hypot(n[0], n[1], n[2]);
      if (len === 0 || Math.abs(n[axis]) / len <= tol) continue;
      const t0 = Math.min(p[a + axis], p[b + axis], p[c + axis]);
      const t1 = Math.max(p[a + axis], p[b + axis], p[c + axis]);
      if (t1 > t0) blocked.push([t0, t1]);
    }
  }
  blocked.sort((u, v) => u[0] - v[0]);
  const free = [];
  let cursor = lo;
  for (const [t0, t1] of blocked) {
    if (t0 > cursor && t0 - cursor >= minLength) free.push({ lo: cursor, hi: t0 });
    cursor = Math.max(cursor, t1);
  }
  if (hi - cursor >= minLength) free.push({ lo: cursor, hi });
  // Ranges touching the outer bounds are the outside faces themselves, not usable cuts.
  return free.filter(r => r.lo > lo && r.hi < hi);
}

/**
 * Suggest a stretch zone on one axis.
 *
 * Picks the longest clean range. If it holds the centre, that range is the zone. If it has a
 * mirror image on the other side of the centre, the zone spans from one to the other, so a
 * feature in the middle (like a snap crown) scales with the part, the way CAD families resize.
 * Each end is kept a small margin inside its clean range.
 *
 * @param {{points: Float64Array, faces: Uint32Array}[]} meshes  first one is the reference part
 * @param {0|1|2} axis
 * @returns {null | {axis: number, a: number, b: number, anchor: number, ranges: {lo:number,hi:number}[]}}
 */
export function suggestZone(meshes, axis, opts = {}) {
  const ranges = cleanRanges(meshes, axis, opts);
  if (!ranges.length) return null;
  const [lo, hi] = bounds(meshes[0]).map(v => v[axis]);
  const centre = (lo + hi) / 2;
  const len = r => r.hi - r.lo;
  const margin = r => Math.min(0.5, len(r) * 0.1);
  const best = ranges.reduce((m, r) => (len(r) > len(m) ? r : m));

  let a, b;
  // A mirror is a range on the other side whose reflection overlaps most of `best`.
  const overlap = r => Math.min(best.hi, 2 * centre - r.lo) - Math.max(best.lo, 2 * centre - r.hi);
  const mirror = ranges
    .filter(r => r !== best && overlap(r) > 0.5 * Math.min(len(r), len(best)))
    .sort((u, v) => overlap(v) - overlap(u))[0];
  if (best.lo < centre && best.hi > centre) {
    a = best.lo + margin(best); b = best.hi - margin(best);
  } else if (mirror) {
    const [low, high] = mirror.lo < best.lo ? [mirror, best] : [best, mirror];
    a = low.lo + margin(low); b = high.hi - margin(high);
  } else {
    a = best.lo + margin(best); b = best.hi - margin(best);
  }
  // Height: keep the bottom on the bed when the part starts at z = 0.
  const anchor = axis === 2 && Math.abs(lo) < 1e-6 ? 0 : 0.5;
  return { axis, name: AXES[axis], a: round(a), b: round(b), anchor, ranges };
}

const round = v => Math.round(v * 1000) / 1000;
