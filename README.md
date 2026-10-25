# Solid to SCAD

Turn STL files into one parametric OpenSCAD file that works in MakerWorld's
Parametric Model Maker (the OpenSCAD Customizer). Work in progress: this is the
core library and a command-line tool. The browser app comes next.

## How it works

Scaling a model makes walls thicker and turns round fillets oval, and parts stop
fitting. Solid to SCAD stretches instead:

1. **Find clean cuts.** On each axis it looks for positions where every triangle that
   crosses the position runs parallel to the axis, so the shape is constant there.
2. **Pick a stretch zone.** The zone runs between clean cuts. Everything outside it
   (corners, end walls, rims) moves without changing shape. Everything inside it is
   scaled, so features in the middle grow with the part, the way CAD families resize.
3. **Link parts.** Parts that share a footprint (a box and its lid) use the same zones,
   so the fit between them stays the same at every size.
4. **Reduce and export.** CAD exports split faces into many small triangles. They are
   merged with [manifold-3d](https://github.com/elalish/manifold) (within 0.001 mm),
   and the mesh is written into the `.scad` as `polyhedron()` data with a Customizer
   slider for each size.

Checked against a box and lid exported from Revit at two sizes: the stretched
result matches Revit's own resized export within 0.03 mm.

## Command line

```sh
npm install
node bin/stl2scad.js box.stl lid.stl -o container.scad --title "My container"
```

The first file is the reference part: its outer size is what the width, length
and height sliders describe. Height only applies to the reference part.

## Tests

```sh
npm test
```

The OpenSCAD render test runs when `openscad` is on the PATH.
