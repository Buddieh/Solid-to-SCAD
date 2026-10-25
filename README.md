# Solid to SCAD

Turn STL files into one parametric OpenSCAD file that works in MakerWorld's
Parametric Model Maker (the OpenSCAD Customizer).

**Use it in the browser:** https://buddieh.github.io/Solid-to-SCAD/

Everything runs on your computer; files are never uploaded.

## How it works

You show the app how your model changes, and it learns the rule:

1. **Export the default.** Export the model (one STL per part) at its default values.
2. **Export one change per value.** For each value people should be able to set, export
   again with only that value changed, and note both values (for example width 35 and 50).
3. **Learn the change.** For each pair the app finds how every slice of the model moves
   along X, Y and Z, by pulling the default mesh onto the changed one. This is the way CAD
   families resize: some regions move without changing shape, some stretch, and features
   in between follow. Walls, fillets and the fit between parts stay as they were.
4. **Check the fit.** The app reports how closely the learned change reproduces the
   changed export. Within 0.05 mm it is exact for printing. Beyond 0.5 mm the value does
   something the app can't learn, and it is left out of the export.
5. **Export.** CAD exports split faces into many small triangles. They are merged with
   [manifold-3d](https://github.com/elalish/manifold) (within 0.001 mm), and the mesh is
   written into the `.scad` as `polyhedron()` data with a Customizer slider per value.
   Values between and beyond the examples are linear blends of the learned change, and
   values combine by adding their changes.

Checked against a box and lid exported from Revit: learned from the default and Revit's
own resized export, the result matches within 0.01 mm, and the `.scad` rendered in
OpenSCAD matches within 0.05 mm.

**What it can't learn:** values that change how many of something there are (an array
or a number of slots), and changes that aren't along X, Y or Z (rotations, bending,
twisting). The fit check catches these instead of exporting something wrong.

## Web app

1. Drop the default export: one STL file per part (a file can hold several bodies).
2. Add a value: give it a name, the default and changed values, and the changed export
   of each part it affects. Leave the other parts empty. Each file shows how closely it
   matched.
3. Adjust the suggested Customizer range if needed (the app won't let a range fold the
   model inside out), and drag the preview slider to check the result.
4. Download the `.scad` and upload it to MakerWorld's Parametric Model Maker.

The sample uses the Revit box and lid. Its single-value exports (width, length and
height changed one at a time) were made with the zone stretch that matches Revit,
see `test/revit.test.js`.

Run it locally with `npm install && npm run dev`, then open http://localhost:8080.
`npm run build` writes the static site to `_site/`. The `pages` workflow deploys it
on every push to `main`.

## Command line

The command line still uses the first version's method, which finds stretch zones in a
single export automatically (it works for box-like models):

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
