// Closest-point queries on a triangle mesh (AABB tree). Used to compare two exports of a model.

/**
 * Closest point on triangle abc to p (Ericson, Real-Time Collision Detection 5.1.5).
 * Writes [qx, qy, qz, u, v, w] into out, where q = u*a + v*b + w*c.
 */
export function closestOnTriangle(px, py, pz, P, ia, ib, ic, out) {
  const ax = P[ia], ay = P[ia + 1], az = P[ia + 2];
  const abx = P[ib] - ax, aby = P[ib + 1] - ay, abz = P[ib + 2] - az;
  const acx = P[ic] - ax, acy = P[ic + 1] - ay, acz = P[ic + 2] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let u, v, w;
  if (d1 <= 0 && d2 <= 0) { u = 1; v = 0; w = 0; }
  else {
    const bpx = px - P[ib], bpy = py - P[ib + 1], bpz = pz - P[ib + 2];
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    const cpx = px - P[ic], cpy = py - P[ic + 1], cpz = pz - P[ic + 2];
    const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
    const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) { u = 0; v = 1; w = 0; }
    else if (d6 >= 0 && d5 <= d6) { u = 0; v = 0; w = 1; }
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) { v = d1 / (d1 - d3); u = 1 - v; w = 0; }
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) { w = d2 / (d2 - d6); u = 1 - w; v = 0; }
    else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); v = 1 - w; u = 0; }
    else { const den = 1 / (va + vb + vc); v = vb * den; w = vc * den; u = 1 - v - w; }
  }
  out[0] = ax + abx * v + acx * w;
  out[1] = ay + aby * v + acy * w;
  out[2] = az + abz * v + acz * w;
  out[3] = u; out[4] = v; out[5] = w;
}

export class TriangleTree {
  /** @param {{points: Float64Array|Float32Array, faces: Uint32Array}} mesh */
  constructor({ points, faces }) {
    this.P = points;
    this.F = faces;
    const n = faces.length / 3;
    const order = new Uint32Array(n);
    const cent = new Float64Array(n * 3);
    for (let t = 0; t < n; t++) {
      order[t] = t;
      for (let k = 0; k < 3; k++) {
        cent[t * 3 + k] = (points[faces[t * 3] * 3 + k] + points[faces[t * 3 + 1] * 3 + k] + points[faces[t * 3 + 2] * 3 + k]) / 3;
      }
    }
    // Nodes: [minx,miny,minz,maxx,maxy,maxz] boxes, children or leaf ranges.
    const boxes = [], left = [], right = [], start = [], count = [];
    const build = (lo, hi) => {
      const id = start.length;
      start.push(lo); count.push(hi - lo); left.push(-1); right.push(-1);
      const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (let i = lo; i < hi; i++) {
        const t = order[i];
        for (let j = 0; j < 3; j++) {
          const v = faces[t * 3 + j] * 3;
          for (let k = 0; k < 3; k++) {
            if (points[v + k] < b[k]) b[k] = points[v + k];
            if (points[v + k] > b[k + 3]) b[k + 3] = points[v + k];
          }
        }
      }
      boxes.push(b);
      if (hi - lo > 8) {
        const axis = [0, 1, 2].reduce((m, k) => (b[k + 3] - b[k] > b[m + 3] - b[m] ? k : m), 0);
        const sub = Array.from(order.subarray(lo, hi)).sort((p, q) => cent[p * 3 + axis] - cent[q * 3 + axis]);
        order.set(sub, lo);
        const mid = (lo + hi) >> 1;
        left[id] = build(lo, mid);
        right[id] = build(mid, hi);
      }
      return id;
    };
    build(0, n);
    this.order = order;
    this.boxes = boxes;
    this.left = left; this.right = right; this.start = start; this.count = count;
    this.tmp = new Float64Array(6);
  }

  /** @returns {{x:number,y:number,z:number,tri:number,u:number,v:number,w:number,d2:number}} */
  closest(px, py, pz) {
    const { P, F, order, boxes, left, right, start, count, tmp } = this;
    let best = { d2: Infinity, x: 0, y: 0, z: 0, tri: -1, u: 0, v: 0, w: 0 };
    const boxDist = id => {
      const b = boxes[id];
      const dx = Math.max(b[0] - px, 0, px - b[3]), dy = Math.max(b[1] - py, 0, py - b[4]), dz = Math.max(b[2] - pz, 0, pz - b[5]);
      return dx * dx + dy * dy + dz * dz;
    };
    const stack = [0];
    while (stack.length) {
      const id = stack.pop();
      if (boxDist(id) >= best.d2) continue;
      if (left[id] < 0) {
        for (let i = start[id], e = start[id] + count[id]; i < e; i++) {
          const t = order[i];
          closestOnTriangle(px, py, pz, P, F[t * 3] * 3, F[t * 3 + 1] * 3, F[t * 3 + 2] * 3, tmp);
          const dx = tmp[0] - px, dy = tmp[1] - py, dz = tmp[2] - pz, d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < best.d2) best = { d2, x: tmp[0], y: tmp[1], z: tmp[2], tri: t, u: tmp[3], v: tmp[4], w: tmp[5] };
        }
      } else {
        const a = left[id], b = right[id];
        const da = boxDist(a), db = boxDist(b);
        if (da < db) { stack.push(b, a); } else { stack.push(a, b); }
      }
    }
    return best;
  }
}

export function faceNormals({ points: P, faces: F }) {
  const n = new Float64Array(F.length);
  for (let t = 0; t < F.length; t += 3) {
    const a = F[t] * 3, b = F[t + 1] * 3, c = F[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    const l = Math.hypot(x, y, z) || 1;
    n[t] = x / l; n[t + 1] = y / l; n[t + 2] = z / l;
  }
  return n;
}

/** Largest distance between two meshes, checked from the vertices and face centres of each. */
export function meshDeviation(a, b) {
  const one = (from, to) => {
    const tree = new TriangleTree(to);
    const { points: P, faces: F } = from;
    let max = 0, sum = 0, n = 0;
    const probe = (x, y, z) => {
      const d = Math.sqrt(tree.closest(x, y, z).d2);
      if (d > max) max = d;
      sum += d; n++;
    };
    for (let i = 0; i < P.length; i += 3) probe(P[i], P[i + 1], P[i + 2]);
    for (let t = 0; t < F.length; t += 3) {
      const ia = F[t] * 3, ib = F[t + 1] * 3, ic = F[t + 2] * 3;
      probe((P[ia] + P[ib] + P[ic]) / 3, (P[ia + 1] + P[ib + 1] + P[ic + 1]) / 3, (P[ia + 2] + P[ib + 2] + P[ic + 2]) / 3);
    }
    return { max, mean: sum / n };
  };
  const ab = one(a, b), ba = one(b, a);
  return { max: Math.max(ab.max, ba.max), mean: (ab.mean + ba.mean) / 2 };
}
