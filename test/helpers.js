import { readFileSync } from 'node:fs';
import { parseSTL, indexMesh } from '../src/core/index.js';

export const load = name => indexMesh(parseSTL(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))));

// Distance from point p to triangle abc (Ericson, Real-Time Collision Detection 5.1.5).
function pointTri(p, a, b, c) {
  const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  let q;
  if (d1 <= 0 && d2 <= 0) q = a;
  else {
    const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
    const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
    const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) q = b;
    else if (d6 >= 0 && d5 <= d6) q = c;
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); q = [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]]; }
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); q = [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]]; }
    else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
      q = [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])];
    } else {
      const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
      q = [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
    }
  }
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** Largest distance from any vertex of `from` to the surface of `to` (brute force, test-sized meshes). */
export function maxVertexDistance(from, to) {
  const P = to.points, F = to.faces;
  const tris = [];
  for (let i = 0; i < F.length; i += 3) {
    const t = [F[i], F[i + 1], F[i + 2]].map(k => [P[k * 3], P[k * 3 + 1], P[k * 3 + 2]]);
    const lo = [0, 1, 2].map(a => Math.min(t[0][a], t[1][a], t[2][a]));
    const hi = [0, 1, 2].map(a => Math.max(t[0][a], t[1][a], t[2][a]));
    tris.push({ t, lo, hi });
  }
  let worst = 0;
  for (let i = 0; i < from.points.length; i += 3) {
    const p = [from.points[i], from.points[i + 1], from.points[i + 2]];
    let best = Infinity;
    for (const { t, lo, hi } of tris) {
      // cheap reject: box distance already worse than best
      let dx = Math.max(lo[0] - p[0], 0, p[0] - hi[0]), dy = Math.max(lo[1] - p[1], 0, p[1] - hi[1]),
        dz = Math.max(lo[2] - p[2], 0, p[2] - hi[2]);
      if (dx * dx + dy * dy + dz * dz >= best * best) continue;
      best = Math.min(best, pointTri(p, ...t));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}
