# Solid to SCAD

Turn STL files into one parametric OpenSCAD file that works in MakerWorld's
Parametric Model Maker (the OpenSCAD Customizer).

**Use it in the browser:** https://buddieh.github.io/Solid-to-SCAD/

Everything runs on your computer; files are never uploaded.

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

## Web app

1. Drop one or more STL files (binary or ASCII). The first one is the reference part.
2. Check the suggested sizes. Each has a strip showing where clean cuts are (green)
   and two handles for the zone. Pick which parts each size changes, set the
   Customizer range, and drag the preview slider to see the result.
3. Download the `.scad` and upload it to MakerWorld's Parametric Model Maker.

Run it locally with `npm install && npm run dev`, then open http://localhost:8080.
`npm run build` writes the static site to `_site/`. The `pages` workflow deploys it
on every push to `main`.

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
