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

/**
 * Write a .scad for a model learned from example exports (see learn.js).
 * Each vertex is stored as three indices into per-axis coordinate tables. Each parameter adds its
 * learned movement to those tables, scaled by how far its value is from the default.
 *
 * @param {object} model
 * @param {string} [model.title]
 * @param {{name: string, label?: string, base: number, variant: number, min: number, max: number, step: number}[]} model.params
 * @param {{name: string, mesh: {points: Float64Array, faces: Uint32Array}, tables: Float64Array[],
 *          index: Uint32Array[], deltas: Object<string, Float64Array[]>}[]} model.parts
 */
export function exportLearnedScad({ title = 'Parametric model', params, parts, decimals = 4, spacing = 5 }) {
  const ident = /^[A-Za-z_][A-Za-z0-9_]*$/;
  for (const p of params) {
    if (!ident.test(p.name)) throw new Error(`Invalid parameter name: ${p.name}`);
    if (p.variant === p.base) throw new Error(`${p.name}: the two example values are the same`);
  }
  for (const part of parts) if (!ident.test(part.name)) throw new Error(`Invalid part name: ${part.name}`);
  // Every generated variable must be distinct from the parameters and from each other.
  const taken = new Map([['part', 'the part selector'], ['spacing', 'the part spacing']]);
  const claim = (id, what) => {
    if (taken.has(id)) throw new Error(`The name "${id}" is used twice (${taken.get(id)} and ${what})`);
    taken.set(id, what);
  };
  for (const p of params) { claim(p.name, `parameter ${p.name}`); claim(`${p.name}_s`, `parameter ${p.name}`); }
  for (const part of parts) {
    for (const a of ['x', 'y', 'z']) {
      claim(`${part.name}_${a}`, `part ${part.name}`);
      claim(`${part.name}_${a}0`, `part ${part.name}`);
      for (const p of params) claim(`${part.name}_${a}_${p.name}`, `part ${part.name}`);
    }
    claim(`${part.name}_v`, `part ${part.name}`);
    claim(`${part.name}_f`, `part ${part.name}`);
  }
  const num = v => {
    const s = v.toFixed(decimals).replace(/\.?0+$/, '');
    return s === '-0' ? '0' : s;
  };
  const list = a => `[${Array.from(a, num).join(',')}]`;
  const L = [];
  L.push(`// ${title.replace(/\n/g, ' ')}`);
  L.push('// Made with Solid to SCAD from example exports: each value blends between the');
  L.push('// shapes it was exported at, so walls, fillets and fits keep their shape.');
  L.push('');
  L.push('/* [Parameters] */');
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
  L.push('function tris(l) = [for (i = [0:3:len(l) - 1]) [l[i], l[i + 1], l[i + 2]]];');
  for (const p of params) L.push(`${p.name}_s = (${p.name} - ${num(p.base)}) / ${num(p.variant - p.base)};`);
  const moving = (d) => d && d.some(v => Math.abs(v) > 1e-5);
  // Mesh data first: OpenSCAD evaluates top-level assignments in order.
  const axesOf = part => [0, 1, 2].map(k => params.filter(p => moving(part.deltas[p.name]?.[k])));
  for (const part of parts) {
    const n = part.name;
    const axes = axesOf(part);
    ['x', 'y', 'z'].forEach((a, k) => {
      L.push(`${n}_${a}0 = ${list(part.tables[k])};`);
      for (const p of axes[k]) L.push(`${n}_${a}_${p.name} = ${list(part.deltas[p.name][k])};`);
    });
    const nv = part.mesh.points.length / 3;
    const v = new Array(nv * 3);
    for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) v[i * 3 + k] = part.index[k][i];
    L.push(`${n}_v = [${v.join(',')}];`);
    const f = part.mesh.faces, fl = new Array(f.length);
    for (let i = 0; i < f.length; i += 3) { fl[i] = f[i + 2]; fl[i + 1] = f[i + 1]; fl[i + 2] = f[i]; }
    L.push(`${n}_f = [${fl.join(',')}];`);
  }
  L.push('');
  parts.forEach(part => {
    const n = part.name;
    const axes = axesOf(part);
    ['x', 'y', 'z'].forEach((a, k) => {
      const terms = axes[k];
      const expr = [`${n}_${a}0[i]`, ...terms.map(p => `${p.name}_s * ${n}_${a}_${p.name}[i]`)].join(' + ');
      L.push(`${n}_${a} = [for (i = [0:len(${n}_${a}0) - 1]) ${expr}];`);
    });
    L.push(`module ${n}() polyhedron([for (i = [0:3:len(${n}_v) - 1]) [${n}_x[${n}_v[i]], ${n}_y[${n}_v[i + 1]], ${n}_z[${n}_v[i + 2]]]], tris(${n}_f), convexity = 10);`);
  });
  L.push('');
  if (parts.length > 1) {
    parts.forEach((part, i) => {
      const n = part.name;
      const offset = i === 0 ? '0'
        : `min(${parts[0].name}_x) + ` + parts.slice(0, i).map(q => `(max(${q.name}_x) - min(${q.name}_x))`).join(' + ') +
          ` + ${i} * spacing - min(${n}_x)`;
      L.push(`if (part == "${n}") ${n}();`);
      L.push(`if (part == "all") translate([${offset}, 0, 0]) ${n}();`);
    });
  } else {
    L.push(`${parts[0].name}();`);
  }
  return L.join('\n') + '\n';
}
