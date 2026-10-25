// STL reading and indexing. Works in the browser and in Node (takes an ArrayBuffer or typed array).

/**
 * Parse a binary or ASCII STL into a triangle soup.
 * @param {ArrayBuffer|Uint8Array} data
 * @returns {Float32Array} 9 floats per triangle
 */
export function parseSTL(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength >= 84) {
    const n = view.getUint32(80, true);
    if (84 + n * 50 === bytes.byteLength) return parseBinary(view, n);
  }
  return parseASCII(new TextDecoder().decode(bytes));
}

function parseBinary(view, n) {
  const out = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50 + 12; // skip the stored normal
    for (let j = 0; j < 9; j++) out[i * 9 + j] = view.getFloat32(o + j * 4, true);
  }
  return out;
}

function parseASCII(text) {
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
  const vals = [];
  let m;
  while ((m = re.exec(text))) vals.push(+m[1], +m[2], +m[3]);
  if (vals.length === 0 || vals.length % 9) throw new Error('Not a valid STL file');
  return new Float32Array(vals);
}

/**
 * Merge identical vertices (exact float match) into an indexed mesh.
 * @param {Float32Array} soup
 * @returns {{points: Float64Array, faces: Uint32Array}}
 */
export function indexMesh(soup) {
  const map = new Map();
  const pts = [];
  const faces = new Uint32Array(soup.length / 3);
  for (let i = 0; i < faces.length; i++) {
    const x = soup[i * 3], y = soup[i * 3 + 1], z = soup[i * 3 + 2];
    const key = x + ',' + y + ',' + z;
    let id = map.get(key);
    if (id === undefined) {
      id = pts.length / 3;
      map.set(key, id);
      pts.push(x, y, z);
    }
    faces[i] = id;
  }
  return { points: Float64Array.from(pts), faces };
}

/** Count edges not shared by exactly two faces. 0 means watertight. */
export function openEdgeCount({ faces }) {
  const count = new Map();
  for (let i = 0; i < faces.length; i += 3) {
    for (let j = 0; j < 3; j++) {
      const a = faces[i + j], b = faces[i + ((j + 1) % 3)];
      const key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
      count.set(key, (count.get(key) || 0) + 1);
    }
  }
  let bad = 0;
  for (const c of count.values()) if (c !== 2) bad++;
  return bad;
}

/** Axis-aligned bounds as [[minX,minY,minZ],[maxX,maxY,maxZ]]. */
export function bounds({ points }) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < points.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = points[i + a];
      if (v < lo[a]) lo[a] = v;
      if (v > hi[a]) hi[a] = v;
    }
  }
  return [lo, hi];
}

/** Signed volume (positive for outward-facing, counter-clockwise triangles). */
export function volume({ points, faces }) {
  let v = 0;
  for (let i = 0; i < faces.length; i += 3) {
    const a = faces[i] * 3, b = faces[i + 1] * 3, c = faces[i + 2] * 3;
    v += points[a] * (points[b + 1] * points[c + 2] - points[b + 2] * points[c + 1])
       - points[a + 1] * (points[b] * points[c + 2] - points[b + 2] * points[c])
       + points[a + 2] * (points[b] * points[c + 1] - points[b + 1] * points[c]);
  }
  return v / 6;
}

/**
 * Write an indexed mesh as binary STL.
 * @param {{points: ArrayLike<number>, faces: ArrayLike<number>}} mesh
 * @returns {Uint8Array}
 */
export function writeSTL({ points: P, faces: F }) {
  const n = F.length / 3;
  const bytes = new Uint8Array(84 + n * 50);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, n, true);
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50;
    const [a, b, c] = [F[t * 3] * 3, F[t * 3 + 1] * 3, F[t * 3 + 2] * 3];
    const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
    const v = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const nrm = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(...nrm) || 1;
    for (let k = 0; k < 3; k++) view.setFloat32(o + k * 4, nrm[k] / l, true);
    [a, b, c].forEach((p, j) => { for (let k = 0; k < 3; k++) view.setFloat32(o + 12 + j * 12 + k * 4, P[p + k], true); });
  }
  return bytes;
}
