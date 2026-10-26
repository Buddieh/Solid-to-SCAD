// A box and lid built in code with manifold-3d, standing in for CAD exports. The shape is the
// kind a parametric CAD program produces: rounded corners of fixed radius, constant walls,
// chamfered edges, a divider in the middle and a lip under the lid. Building it at another size gives the exact
// export that program would make, so the tests have a ground truth for every value.

import Module from 'manifold-3d';

const wasm = await Module();
wasm.setup();
const { CrossSection, Manifold } = wasm;

const SEGMENTS = 32;
const rounded = (w, l, r) => CrossSection.square([w - 2 * r, l - 2 * r], true).offset(r, 'Round', 2, SEGMENTS);

function toMesh(solid) {
  const m = solid.getMesh();
  const points = new Float64Array(m.numVert * 3);
  for (let i = 0; i < m.numVert; i++) for (let k = 0; k < 3; k++) points[i * 3 + k] = m.vertProperties[i * m.numProp + k];
  return { points, faces: Uint32Array.from(m.triVerts) };
}

// Solid that changes from one rounded rectangle at z0 to another at z1 (a chamfer band).
const taper = (from, to, z0, z1) => Manifold.hull([
  from.extrude(0.001).translate([0, 0, z0]), to.extrude(0.001).translate([0, 0, z1 - 0.001]),
]);

/** Open box, centred on X and Y, standing on Z = 0, with chamfered foot, rim and inside floor edge. */
export function makeBox({ width = 35, length = 105, height = 30, divider = true } = {}) {
  const wall = 2, floor = 2;
  const outer = taper(rounded(width - 2, length - 2, 2), rounded(width, length, 3), 0, 1)
    .add(rounded(width, length, 3).extrude(height - 1).translate([0, 0, 1]));
  const cavity = taper(rounded(width - 2 * wall - 1, length - 2 * wall - 1, 0.5), rounded(width - 2 * wall, length - 2 * wall, 1), floor, floor + 0.5)
    .add(rounded(width - 2 * wall, length - 2 * wall, 1).extrude(height - floor - 0.5).translate([0, 0, floor + 0.5]))
    .add(taper(rounded(width - 2 * wall, length - 2 * wall, 1), rounded(width - wall, length - wall, 1.5), height - 0.5, height + 0.001));
  const box = outer.subtract(cavity);
  if (!divider) return toMesh(box);
  const wallPiece = Manifold.cube([width - 2 * wall, 1.5, height - floor], true)
    .translate([0, 0, floor + (height - floor) / 2]);
  return toMesh(box.add(wallPiece));
}

/** Lid that sits on the box: a plate with a lip that fits inside the walls. */
export function makeLid({ width = 35, length = 105 } = {}) {
  const plate = rounded(width, length, 3).extrude(2).translate([0, 0, 3]);
  const lip = rounded(width - 4.4, length - 4.4, 0.8).extrude(3);
  const hollow = rounded(width - 8.4, length - 8.4, 0.5).extrude(3);
  return toMesh(plate.add(lip.subtract(hollow)));
}
