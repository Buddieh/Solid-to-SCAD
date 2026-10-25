// Shape-preserving mesh reduction with manifold-3d. CAD exports split flat and gently curved
// faces into many small triangles; merging them keeps the shape within `tolerance` mm and makes
// the exported .scad far smaller and faster to render.

let wasmPromise;
async function manifold() {
  if (!wasmPromise) {
    wasmPromise = import('manifold-3d').then(async ({ default: Module }) => {
      const wasm = await Module();
      wasm.setup();
      return wasm;
    });
  }
  return wasmPromise;
}

/**
 * @param {{points: Float64Array, faces: Uint32Array}} mesh
 * @param {number} tolerance  max surface movement in mm
 * @returns {Promise<{points: Float64Array, faces: Uint32Array}>}
 */
export async function simplifyMesh(mesh, tolerance = 0.001) {
  const wasm = await manifold();
  const input = new wasm.Mesh({
    numProp: 3,
    vertProperties: Float32Array.from(mesh.points),
    triVerts: Uint32Array.from(mesh.faces),
  });
  const solid = new wasm.Manifold(input);
  const status = solid.status();
  if (status !== 'NoError') {
    solid.delete();
    throw new Error(`Mesh is not a valid closed solid (${status})`);
  }
  const reduced = solid.simplify(tolerance);
  const out = reduced.getMesh();
  const points = new Float64Array(out.numVert * 3);
  for (let i = 0; i < out.numVert; i++) {
    for (let j = 0; j < 3; j++) points[i * 3 + j] = out.vertProperties[i * out.numProp + j];
  }
  const faces = Uint32Array.from(out.triVerts);
  solid.delete();
  reduced.delete();
  return { points, faces };
}
