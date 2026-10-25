// Learn how a model changes from two exports: the default and one with a single value changed.
//
// The change is modelled per axis as a monotone map t -> f(t), applied separately to x, y and z.
// Only f's values at the base mesh's distinct vertex coordinates matter (triangles stay flat
// between them), so those values are the unknowns. They are fitted with symmetric
// point-to-plane ICP: samples on each mesh are pulled onto the other mesh's surface along the
// surface normal. An L1 penalty on slope changes keeps f piecewise linear, with breakpoints only
// where the data asks for one, which is what CAD families do: some slices move rigidly, some
// stretch, and features in between follow. Values between the two exports are linear blends.

import { TriangleTree, faceNormals, meshDeviation } from './bvh.js';

/** Distinct coordinates per axis, and each vertex's index into them. */
export function coordinateTables({ points }, eps = 1e-4) {
  const n = points.length / 3;
  const tables = [], index = [];
  for (let k = 0; k < 3; k++) {
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => points[a * 3 + k] - points[b * 3 + k]);
    const values = [];
    const idx = new Uint32Array(n);
    for (const i of order) {
      const t = points[i * 3 + k];
      if (!values.length || t - values[values.length - 1] > eps) values.push(t);
      idx[i] = values.length - 1;
    }
    tables.push(Float64Array.from(values));
    index.push(idx);
  }
  return { tables, index };
}

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Area-weighted random points on a mesh, as (triangle, barycentric) pairs. */
function sampleFaces({ points: P, faces: F }, count, seed) {
  const nt = F.length / 3;
  const cum = new Float64Array(nt);
  let total = 0;
  for (let t = 0; t < nt; t++) {
    const a = F[t * 3] * 3, b = F[t * 3 + 1] * 3, c = F[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    total += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    cum[t] = total;
  }
  const r = rng(seed);
  const tri = new Uint32Array(count), bary = new Float64Array(count * 3);
  for (let i = 0; i < count; i++) {
    const x = r() * total;
    let lo = 0, hi = nt - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < x) lo = m + 1; else hi = m; }
    tri[i] = lo;
    const r1 = Math.sqrt(r()), r2 = r();
    bary[i * 3] = 1 - r1; bary[i * 3 + 1] = r1 * (1 - r2); bary[i * 3 + 2] = r1 * r2;
  }
  return { tri, bary };
}

// Least squares over sparse rows (cols, vals, rhs). Small systems use the normal equations with a
// dense Cholesky factorisation (exact; the slope-change rows make the system badly conditioned,
// which iterative solvers handle poorly). Large ones fall back to CGLS.
function leastSquares(rows, n, x0) {
  if (n > 2500) return cgls(rows, n, x0, 2000);
  const { ptr, col, val, rhs } = rows;
  const A = new Float64Array(n * n), b = new Float64Array(n);
  for (let r = 0; r + 1 < ptr.length; r++) {
    for (let i = ptr[r]; i < ptr[r + 1]; i++) {
      const ci = col[i], vi = val[i];
      b[ci] += vi * rhs[r];
      for (let j = ptr[r]; j < ptr[r + 1]; j++) A[ci * n + col[j]] += vi * val[j];
    }
  }
  // Tiny pull towards the current solution keeps unconstrained values put and A positive definite.
  let scale = 0;
  for (let i = 0; i < n; i++) scale = Math.max(scale, A[i * n + i]);
  const ridge = 1e-10 * (scale || 1);
  for (let i = 0; i < n; i++) { A[i * n + i] += ridge; b[i] += ridge * x0[i]; }
  // In-place Cholesky A = L L^T (lower triangle).
  for (let j = 0; j < n; j++) {
    let d = A[j * n + j];
    for (let k = 0; k < j; k++) d -= A[j * n + k] * A[j * n + k];
    if (!(d > 0)) return cgls(rows, n, x0, 2000);
    const ljj = Math.sqrt(d);
    A[j * n + j] = ljj;
    for (let i = j + 1; i < n; i++) {
      let s = A[i * n + j];
      for (let k = 0; k < j; k++) s -= A[i * n + k] * A[j * n + k];
      A[i * n + j] = s / ljj;
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= A[i * n + k] * y[k]; y[i] = s / A[i * n + i]; }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= A[k * n + i] * x[k]; x[i] = s / A[i * n + i]; }
  return x;
}

// Sparse least squares by CGLS from x0.
function cgls(rows, n, x0, iters) {
  const { ptr, col, val, rhs } = rows;
  const m = rhs.length;
  const mul = (x, out) => { for (let r = 0; r < m; r++) { let s = 0; for (let j = ptr[r]; j < ptr[r + 1]; j++) s += val[j] * x[col[j]]; out[r] = s; } };
  const mulT = (y, out) => { out.fill(0); for (let r = 0; r < m; r++) { const v = y[r]; if (!v) continue; for (let j = ptr[r]; j < ptr[r + 1]; j++) out[col[j]] += val[j] * v; } };
  const x = Float64Array.from(x0);
  const res = new Float64Array(m), Ap = new Float64Array(m);
  mul(x, res);
  for (let r = 0; r < m; r++) res[r] = rhs[r] - res[r];
  const s = new Float64Array(n); mulT(res, s);
  const p = Float64Array.from(s);
  let gamma = s.reduce((a, v) => a + v * v, 0);
  const g0 = gamma;
  for (let it = 0; it < iters && gamma > 1e-20 * g0; it++) {
    mul(p, Ap);
    const q2 = Ap.reduce((a, v) => a + v * v, 0);
    if (!q2) break;
    const alpha = gamma / q2;
    for (let i = 0; i < n; i++) x[i] += alpha * p[i];
    for (let r = 0; r < m; r++) res[r] -= alpha * Ap[r];
    mulT(res, s);
    const g = s.reduce((a, v) => a + v * v, 0);
    const beta = g / gamma;
    gamma = g;
    for (let i = 0; i < n; i++) p[i] = s[i] + beta * p[i];
  }
  return x;
}

// Closest monotone sequence with gaps of at least minGap[i] (pool-adjacent-violators).
function makeMonotone(f, minGap) {
  const n = f.length;
  const c = new Float64Array(n);
  for (let i = 1; i < n; i++) c[i] = c[i - 1] + minGap[i - 1];
  const h = Array.from(f, (v, i) => v - c[i]);
  const val = [], wt = [], len = [];
  for (const v of h) {
    val.push(v); wt.push(1); len.push(1);
    while (val.length > 1 && val[val.length - 2] > val[val.length - 1]) {
      const v2 = val.pop(), w2 = wt.pop(), l2 = len.pop();
      const i = val.length - 1;
      val[i] = (val[i] * wt[i] + v2 * w2) / (wt[i] + w2); wt[i] += w2; len[i] += l2;
    }
  }
  const out = new Float64Array(n);
  let i = 0;
  val.forEach((v, b) => { for (let j = 0; j < len[b]; j++, i++) out[i] = v + c[i]; });
  return out;
}

/**
 * @param {{points: Float64Array, faces: Uint32Array}} base     default export (ideally simplified)
 * @param {{points: Float64Array, faces: Uint32Array}} variant  same model with one value changed
 * @returns {{tables: Float64Array[], index: Uint32Array[], delta: Float64Array[], fit: {max:number, mean:number}}}
 *   delta[k][i] is how far coordinate tables[k][i] moves between base and variant.
 */
export function learnChange(base, variant, { iterations = 12, samples = 12000, smooth = 0.05, onProgress } = {}) {
  const { tables, index } = coordinateTables(base);
  const sizes = tables.map(t => t.length);
  const off = [0, sizes[0], sizes[0] + sizes[1]];
  const N = sizes[0] + sizes[1] + sizes[2];
  const bounds = m => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < m.points.length; i++) { const k = i % 3; lo[k] = Math.min(lo[k], m.points[i]); hi[k] = Math.max(hi[k], m.points[i]); }
    return [lo, hi];
  };
  const [alo, ahi] = bounds(base), [blo, bhi] = bounds(variant);
  // Start from stretching each axis's bounding box onto the variant's.
  let f = tables.map((t, k) => t.map(v => blo[k] + (v - alo[k]) * (bhi[k] - blo[k]) / ((ahi[k] - alo[k]) || 1)));
  const minGap = tables.map(t => Float64Array.from({ length: t.length - 1 }, (_, i) => 0.05 * (t[i + 1] - t[i])));

  const vTree = new TriangleTree(variant);
  const vNormals = faceNormals(variant);
  const sa = sampleFaces(base, samples, 1);
  const sb = sampleFaces(variant, samples, 2);
  const sbPts = new Float64Array(samples * 3);
  for (let i = 0; i < samples; i++) {
    const t = sb.tri[i];
    for (let k = 0; k < 3; k++) {
      sbPts[i * 3 + k] = sb.bary[i * 3] * variant.points[variant.faces[t * 3] * 3 + k] +
        sb.bary[i * 3 + 1] * variant.points[variant.faces[t * 3 + 1] * 3 + k] +
        sb.bary[i * 3 + 2] * variant.points[variant.faces[t * 3 + 2] * 3 + k];
    }
  }
  const F = base.faces;
  const nv = base.points.length / 3;

  for (let it = 0; it < iterations; it++) {
    const mapped = new Float64Array(nv * 3);
    for (let v = 0; v < nv; v++) for (let k = 0; k < 3; k++) mapped[v * 3 + k] = f[k][index[k][v]];
    const mesh = { points: mapped, faces: F };
    const mNormals = faceNormals(mesh);
    const mTree = new TriangleTree(mesh);
    const ptr = [0], col = [], val = [], rhs = [];
    const dists = [];
    const addRow = (t, b0, b1, b2, nx, ny, nz, target) => {
      const n = [nx, ny, nz], b = [b0, b1, b2];
      for (let j = 0; j < 3; j++) {
        const v = F[t * 3 + j];
        for (let k = 0; k < 3; k++) { col.push(off[k] + index[k][v]); val.push(b[j] * n[k]); }
      }
      rhs.push(target);
      ptr.push(col.length);
    };
    const pending = [];
    // Base samples, mapped, pulled onto the variant.
    for (let i = 0; i < samples; i++) {
      const t = sa.tri[i];
      const p = [0, 1, 2].map(k => sa.bary[i * 3] * mapped[F[t * 3] * 3 + k] + sa.bary[i * 3 + 1] * mapped[F[t * 3 + 1] * 3 + k] + sa.bary[i * 3 + 2] * mapped[F[t * 3 + 2] * 3 + k]);
      const c = vTree.closest(p[0], p[1], p[2]);
      const n = [vNormals[c.tri * 3], vNormals[c.tri * 3 + 1], vNormals[c.tri * 3 + 2]];
      if (n[0] * mNormals[t * 3] + n[1] * mNormals[t * 3 + 1] + n[2] * mNormals[t * 3 + 2] < 0.3) continue;
      dists.push(Math.sqrt(c.d2));
      pending.push([Math.sqrt(c.d2), t, sa.bary[i * 3], sa.bary[i * 3 + 1], sa.bary[i * 3 + 2], n, n[0] * c.x + n[1] * c.y + n[2] * c.z]);
    }
    // Variant samples pulled onto the mapped base.
    for (let i = 0; i < samples; i++) {
      const x = sbPts[i * 3], y = sbPts[i * 3 + 1], z = sbPts[i * 3 + 2];
      const c = mTree.closest(x, y, z);
      const tv = sb.tri[i];
      const n = [vNormals[tv * 3], vNormals[tv * 3 + 1], vNormals[tv * 3 + 2]];
      if (n[0] * mNormals[c.tri * 3] + n[1] * mNormals[c.tri * 3 + 1] + n[2] * mNormals[c.tri * 3 + 2] < 0.3) continue;
      dists.push(Math.sqrt(c.d2));
      pending.push([Math.sqrt(c.d2), c.tri, c.u, c.v, c.w, n, n[0] * x + n[1] * y + n[2] * z]);
    }
    const sorted = Float64Array.from(dists).sort();
    const cutoff = Math.max(2, 10 * (sorted[sorted.length >> 1] || 0));
    for (const [d, t, b0, b1, b2, n, target] of pending) if (d <= cutoff) addRow(t, b0, b1, b2, n[0], n[1], n[2], target);

    // Penalty on slope changes, reweighted so it acts like L1 (few, sharp breakpoints).
    const x0 = new Float64Array(N);
    for (let k = 0; k < 3; k++) x0.set(f[k], off[k]);
    for (let k = 0; k < 3; k++) {
      const t = tables[k];
      for (let i = 0; i + 2 < t.length; i++) {
        const h1 = t[i + 1] - t[i], h2 = t[i + 2] - t[i + 1];
        const c0 = 1 / h1, c1 = -(1 / h1 + 1 / h2), c2 = 1 / h2;
        const sd = c0 * x0[off[k] + i] + c1 * x0[off[k] + i + 1] + c2 * x0[off[k] + i + 2];
        const w = Math.sqrt(smooth / Math.sqrt(sd * sd + 1e-6));
        col.push(off[k] + i, off[k] + i + 1, off[k] + i + 2);
        val.push(w * c0, w * c1, w * c2);
        rhs.push(0);
        ptr.push(col.length);
      }
    }
    const x = leastSquares({ ptr, col: Uint32Array.from(col), val: Float64Array.from(val), rhs: Float64Array.from(rhs) }, N, x0);
    f = tables.map((_, k) => makeMonotone(x.subarray(off[k], off[k] + sizes[k]), minGap[k]));
    onProgress?.((it + 1) / iterations);
  }

  const delta = tables.map((t, k) => t.map((v, i) => f[k][i] - v));
  const result = { tables, index, delta };
  result.fit = meshDeviation(applyChanges(base, result, [1]), variant);
  return result;
}

/**
 * Move a base mesh by a blend of learned changes.
 * @param {{points: Float64Array, faces: Uint32Array}} base
 * @param {{tables: Float64Array[], index: Uint32Array[], delta?: Float64Array[]}} learned  tables/index of the base
 * @param {number[]} amounts  s_j for each change; s = 0 is the default export, 1 the variant
 * @param {Float64Array[][]} [deltas]  one delta set per change (defaults to learned.delta)
 */
export function applyChanges(base, learned, amounts, deltas = [learned.delta]) {
  const { tables, index } = learned;
  const moved = tables.map((t, k) => t.map((v, i) => v + deltas.reduce((s, d, j) => s + amounts[j] * d[k][i], 0)));
  const n = base.points.length / 3;
  const points = new Float64Array(n * 3);
  for (let v = 0; v < n; v++) for (let k = 0; k < 3; k++) points[v * 3 + k] = moved[k][index[k][v]];
  return { points, faces: base.faces };
}

/**
 * Range of a change amount s (for one change alone) where the mesh can't fold: every gap between
 * neighbouring coordinates must keep at least `keep` of its default length.
 * @returns {[number, number]} [sMin, sMax], possibly infinite
 */
export function safeRange(tables, delta, keep = 0.05) {
  let lo = -Infinity, hi = Infinity;
  for (let k = 0; k < 3; k++) {
    const t = tables[k], d = delta[k];
    for (let i = 0; i + 1 < t.length; i++) {
      const g = t[i + 1] - t[i], dg = d[i + 1] - d[i];
      if (Math.abs(dg) < 1e-9) continue;
      // g + s*dg >= keep*g
      const limit = (keep - 1) * g / dg;
      if (dg > 0) lo = Math.max(lo, limit); else hi = Math.min(hi, limit);
    }
  }
  return [lo, hi];
}
