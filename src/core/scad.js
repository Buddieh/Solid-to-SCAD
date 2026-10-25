// Write one self-contained .scad file for MakerWorld's Parametric Model Maker (OpenSCAD Customizer).
// Meshes are embedded as flat number lists and rebuilt with polyhedron(); each size parameter
// moves points through its stretch zone (see stretch.js for the maths, mirrored in zmap below).

import { bounds } from './stl.js';

/**
 * @typedef {object} Param
 * @property {string} name        OpenSCAD variable name, e.g. "width"
 * @property {string} [label]     Customizer description
 * @property {{axis: 0|1|2, a: number, b: number, anchor: number}} zone
 * @property {number} base        size of the reference part on this axis in the source mesh
 * @property {number} min
 * @property {number} max
 * @property {number} step
 * @property {string[]} parts     names of the parts this parameter changes
 *
 * @typedef {object} Part
 * @property {string} name        identifier, e.g. "box"
 * @property {{points: Float64Array, faces: Uint32Array}} mesh  outward-facing (counter-clockwise)
 */

/**
 * @param {{title?: string, parts: Part[], params: Param[], decimals?: number, spacing?: number}} model
 * @returns {string}
 */
export function exportScad({ title = 'Parametric model', parts, params, decimals = 3, spacing = 5 }) {
  for (const p of params) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.name)) throw new Error(`Invalid parameter name: ${p.name}`);
    if (p.min <= p.base - (p.zone.b - p.zone.a)) throw new Error(`${p.name}: minimum ${p.min} collapses its stretch zone`);
  }
  for (const part of parts) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(part.name)) throw new Error(`Invalid part name: ${part.name}`);
  }
  const num = v => {
    const s = v.toFixed(decimals).replace(/\.?0+$/, '');
    return s === '-0' ? '0' : s;
  };
  const L = [];
  L.push(`// ${title.replace(/\n/g, ' ')}`);
  L.push('// Made with Solid to SCAD. Sizes change by stretching straight sections,');
  L.push('// so walls, fillets and fits between parts keep their shape.');
  L.push('');
  L.push('/* [Size] */');
  for (const p of params) {
    if (p.label) L.push(`// ${p.label}`);
    L.push(`${p.name} = ${num(p.base)}; // [${num(p.min)}:${num(p.step)}:${num(p.max)}]`);
  }
  L.push('');
  if (parts.length > 1) {
    L.push('/* [Output] */');
    L.push(`part = "all"; // [all, ${parts.map(p => p.name).join(', ')}]`);
    L.push('// Gap between parts when printing all of them, mm');
    L.push(`spacing = ${num(spacing)}; // [1:1:20]`);
    L.push('');
  }
  L.push('/* [Hidden] */');
  L.push('// Stretch zone [a, b] on one axis, anchor f, size change d (see Solid to SCAD docs)');
  L.push('function zmap(t, a, b, f, d) = t < a ? t - f * d : t > b ? t + (1 - f) * d');
  L.push('  : a - f * d + (t - a) * (b - a + d) / (b - a);');
  L.push('function tris(l) = [for (i = [0:3:len(l) - 1]) [l[i], l[i + 1], l[i + 2]]];');
  for (const p of params) {
    const z = p.zone;
    L.push(`${p.name}_z = [${num(z.a)}, ${num(z.b)}, ${num(z.anchor)}, ${p.name} - ${num(p.base)}];`);
  }
  L.push('function sz(t, z) = zmap(t, z[0], z[1], z[2], z[3]);');
  L.push('');

  const axisExpr = (part, axis, v) => {
    const p = params.find(q => q.zone.axis === axis && q.parts.includes(part.name));
    return p ? `sz(${v}, ${p.name}_z)` : v;
  };
  parts.forEach(part => {
    const n = part.name;
    const [lo, hi] = bounds(part.mesh);
    L.push(`function ${n}_pts() = [for (i = [0:3:len(${n}_p) - 1]) [${axisExpr(part, 0, `${n}_p[i]`)}, ` +
      `${axisExpr(part, 1, `${n}_p[i + 1]`)}, ${axisExpr(part, 2, `${n}_p[i + 2]`)}]];`);
    L.push(`${n}_x = [${axisExpr(part, 0, num(lo[0]))}, ${axisExpr(part, 0, num(hi[0]))}];`);
    L.push(`module ${n}() polyhedron(${n}_pts(), tris(${n}_f), convexity = 10);`);
  });
  L.push('');
  if (parts.length > 1) {
    // Lay parts out left to right along X, each starting `spacing` after the previous one ends.
    parts.forEach((part, i) => {
      const n = part.name;
      const prev = parts.slice(0, i);
      const offset = i === 0 ? '0'
        : `${parts[0].name}_x[0] + ` + prev.map(q => `(${q.name}_x[1] - ${q.name}_x[0])`).join(' + ') +
          ` + ${i} * spacing - ${n}_x[0]`;
      L.push(`if (part == "${n}") ${n}();`);
      L.push(`if (part == "all") translate([${offset}, 0, 0]) ${n}();`);
    });
  } else {
    L.push(`${parts[0].name}();`);
  }
  L.push('');
  for (const part of parts) {
    const { points, faces } = part.mesh;
    const fl = new Array(faces.length);
    for (let i = 0; i < faces.length; i += 3) {
      // OpenSCAD wants faces clockwise seen from outside, so reverse each triangle.
      fl[i] = faces[i + 2]; fl[i + 1] = faces[i + 1]; fl[i + 2] = faces[i];
    }
    L.push(`${part.name}_p = [${Array.from(points, num).join(',')}];`);
    L.push(`${part.name}_f = [${fl.join(',')}];`);
  }
  return L.join('\n') + '\n';
}
