// Stretch zones.
//
// A zone on one axis is an interval [a, b]. When the size on that axis changes by d:
//   - points below a move by -f*d
//   - points above b move by +(1-f)*d
//   - points inside [a, b] are scaled linearly so the mesh stays continuous
// f is the anchor: 0.5 grows both ends equally, 0 keeps the low end fixed (e.g. the bed).
//
// The map is monotonic as long as the zone keeps a positive length, so triangles never fold,
// for growing and shrinking alike. It is exact for geometry that is constant (prismatic)
// where triangles cross a and b, and it scales features inside the zone with the part.
// This is how parametric CAD programs typically resize, which is why matching a CAD export is
// the reference test.

/** @typedef {{axis: 0|1|2, a: number, b: number, anchor: number}} Zone */

export function mapValue(t, zone, d) {
  const { a, b, anchor: f } = zone;
  if (t < a) return t - f * d;
  if (t > b) return t + (1 - f) * d;
  return a - f * d + (t - a) * (b - a + d) / (b - a);
}

/** Smallest allowed size change (the zone would collapse below this). */
export function minDelta(zone) {
  return -(zone.b - zone.a);
}

/**
 * Apply size changes to a mesh.
 * @param {{points: Float64Array, faces: Uint32Array}} mesh
 * @param {{zone: Zone, d: number}[]} changes
 */
export function stretchMesh(mesh, changes) {
  const points = Float64Array.from(mesh.points);
  for (const { zone, d } of changes) {
    if (d <= minDelta(zone)) throw new Error(`Size change ${d} collapses the zone on axis ${zone.axis}`);
    for (let i = zone.axis; i < points.length; i += 3) points[i] = mapValue(points[i], zone, d);
  }
  return { points, faces: mesh.faces };
}
