# The Lexington: structural model

A 3D finite-element model of the building, built from the as-built record, with its loads, a
gravity / wind / earthquake analysis and Eurocode checks, and a 3D viewer with layers
(structure now; architecture, MEP and the rest to follow).

```
python3 structure/run.py                 # builds the model, runs everything (about 4 minutes)
open structure/viewer/index.html         # the 3D viewer (serve the repo folder: it fetches ../out/viewer-data.json)
```

Needs `pip install openseespy numpy scipy shapely`, and Node 22+ for the exporters.

## Where the building comes from

| File | What | Made by |
|---|---|---|
| `model/asbuilt.json` | Grid, columns, shear walls, lift cores, slab outlines, openings per floor, **as built where taped**, else the drawing | `node structure/tools/export-asbuilt.ts [backup.json] > structure/model/asbuilt.json` (runs the as-built app's own geometry code) |
| `model/slabs.json` | Each floor's slab thickness and beam schedule, as the concrete estimator reads the engineer's drawings | `node --import ./structure/tools/alias.mjs structure/tools/export-slabs.ts > structure/model/slabs.json` |
| `model/loads.json` | Materials, stiffness, loads, wind and earthquake parameters, each with its source | edit by hand |
| `model/r10_vertical.json` | Column, wall and foundation schedules transcribed from the engineer's R10 set (Jan 2025) | transcribed from the PDF |

To use the site's tapes, download the full backup from the admin As-built page
(`/admin/asbuilt/export?format=json`) and run the first exporter with it, then `run.py`.

## What the model is

- **Slabs**: shell elements (ShellMITC4) on a mesh along the grid lines, beam lines, slab edges, openings and lift
  walls; voids, stairs, the pool and the lift shafts are holes.
- **Beams**: frame elements along their grid lines (sizes from `slabs.json`); the pool's 1800 x 300 walls as deep beams.
- **Columns and shear walls**: frame elements on their own centre lines, tied to the slab by rigid links (a column
  off its line keeps its eccentricity); walls also have stiff arms to the slab at their ends.
- **Lift cores**: shell walls, three elements per storey, lift door left out.
- **Base**: fixed at the ground floor (+0.300). Foundation loads are reported there.
- **Stiffness**: cracked sections (columns 0.7 I, walls 0.7, beams 0.35, slab bending 0.25).

## Analyses and checks

- Gravity: self-weight, finishes and walls, imposed load. Every reaction adds back to the applied load.
- Wind: EN 1991-1-4, Accra 20 m/s (10-min mean), terrain III, with torsion e = b/10.
- Earthquake: EN 1998-1 response spectrum (modes from the floors condensed to x, y and twist, CQC), accidental
  torsion, Ex + 0.3Ey. Ghana Building Code level 0.35 g, with 0.20 g as a sensitivity.
- Columns and walls: EN 1992-1-1 biaxial strain-compatibility capacity with the R10 bars, imperfection and
  second-order effects (nominal curvature); the steel needed is worked out for every column.
- Lift cores: section forces at each storey, vertical steel needed.
- Beams: bending (with compression steel where needed) and shear (variable strut angle).
- Foundations: pad size at 400 kPa for service loads; overturning and uplift in the earthquake; comparison with
  the R10 bases.
- Drift, P-delta (theta) and the torsional-flexibility check.

## Not in yet

- The site's tapes (needs the as-built backup), and the plan walls as line loads.
- Engineer's drawings for floors 5-7 and the roof (the 4th floor's slab and beams are used).
- Beam and slab reinforcement as drawn (the steel needed is reported instead).
- Stub columns, ground beams and bases below +0.300; soil springs.
- Capacity design (strong column / weak beam) and detailing rules of EN 1998-1 chapter 5.
