# The Lexington: structural model

A 3D finite-element model of the building, built from the as-built record, with its loads, a
gravity / wind / earthquake analysis and Eurocode checks, and a 3D viewer with layers: the structure, the
architecture (walls, windows, balconies, layouts, homes) and the site; MEP to follow.

```
python3 structure/run.py                          # builds the model, runs everything (about 4 minutes)
python3 structure/tools/refresh_architecture.py   # only the viewer's architecture and site layers (seconds)
open structure/viewer/index.html                  # the 3D viewer (serve the repo folder: it fetches ../out/viewer-data.json)
```

Needs `pip install openseespy numpy scipy shapely`, and Node 22+ for the exporters (`pymupdf` to re-read the
architect's windows).

**Private mode.** `LEX_PRIVATE=1` in front of any of these reads the live as-built tapes and plans-editor layouts from
`structure/private/` (git-ignored) and writes to `structure/private/out/`, so they never reach the repository.

## Where the building comes from

| File | What | Made by |
|---|---|---|
| `model/asbuilt.json` | Grid, columns, shear walls, lift cores, slab outlines, openings per floor, **as built where taped**, else the drawing | `node structure/tools/export-asbuilt.ts [backup.json] > structure/model/asbuilt.json` (runs the as-built app's own geometry code) |
| `model/slabs.json` | Each floor's slab thickness and beam schedule, as the concrete estimator reads the engineer's drawings | `node --import ./structure/tools/alias.mjs structure/tools/export-slabs.ts > structure/model/slabs.json` |
| `model/loads.json` | Materials, stiffness, loads, wind and earthquake parameters, each with its source | edit by hand |
| `model/r10_vertical.json` | Column, wall and foundation schedules transcribed from the engineer's R10 set (Jan 2025) | transcribed from the PDF |
| `model/arch_windows.json` | Every window on the architect's floor plans (A105-A110) with the wall it is in, as grid references, and its size, sill and head from the window schedule (A119) | `python3 structure/tools/read_arch_windows.py Architecture_FINAL_FINAL_PRIINT.pdf > structure/model/arch_windows.json` |
| `model/architecture.json` | Which plans-editor layout to show per floor, open areas (the pool deck, the roof terrace between the penthouses), the room words allowed through | edit by hand |
| `model/website.json` | The homes as the live website lists them | `python3 structure/tools/fetch_website.py` |
| `private/plans.json` | The plans editor's floor layouts (walls, doors, windows, rooms, homes) on the as-built geometry | `node --import ./structure/tools/alias.mjs structure/tools/export-plans.ts plans_live.json asbuilt_live.json` |

Drawings read so far: R10 (Jan 2025, the full set), the updated raft details (18 Feb 2026: raft layout and zones,
sections, reinforcement, rebar seats, columns and walls), R26 (5 Oct 2026: general notes with C30/37 concrete, 1st and
2nd floor), the 1st floor (10 Oct) and 2nd floor (12 Oct) revisions, and the 3rd/4th floor R28 (2 Nov; R28_1 is the same
with a duplicate page dropped). Not yet: floors 5-7 and the roof. As built the raft is on bedrock about 2 m down.

To use the site's tapes, download the full backup from the admin As-built page
(`/admin/asbuilt/export?format=json`) and run the first exporter with it, then `run.py`.

## What the model is

- **Slabs**: shell elements (ShellMITC4) on a mesh along the grid lines, beam lines, slab edges, openings and lift
  walls; voids, stairs, the pool and the lift shafts are holes.
- **Beams**: frame elements along their grid lines (sizes from `slabs.json`); the pool's walls (1850 x 300, per the Oct 2026 1st floor sections) as deep beams.
- **Columns and shear walls**: frame elements on their own centre lines, tied to the slab by rigid links (a column
  off its line keeps its eccentricity); walls also have stiff arms to the slab at their ends.
- **Lift cores**: shell walls, three elements per storey, lift door left out.
- **Foundation**: the full raft of the 18 Feb 2026 raft details (shells on vertical rock springs, held sideways by stiff
  springs) with its zones: 450 mm in the basement wing, 500 mm elsewhere, 700 mm bases under the lift cores and on lines
  C, G, L and M; the columns and cores stand on it (`loads.json` > `foundation`). It is placed at the ground floor level
  (as built it is on bedrock about 2 m down), with the fill, the basement and the water tank as loads on it. Set `type`
  to `pads` to fix the columns at +0.300 instead.
- **Stiffness**: cracked sections (columns 0.7 I, walls 0.7, beams 0.35, slab bending 0.25).

## The architecture layer (viewer)

- **Walls** (225 mm block) on the as-built slab edges, outer face flush; on the 7th floor, under the roof.
- **Windows** from the architect's plans, put on the as-built grid: the wall line keeps its offset from the nearest grid
  line, the window its place in the bay. A window within 0.75 m of the slab edge goes on the edge (the as-built edge
  wins); one 0.75-3 m behind it sets the wall back between the grid lines either side, and the slab in front becomes a
  balcony with a glass balustrade. That gives the staggered boxes and balconies of the renders floor by floor. The
  architect's sheets are a storey behind the as-built names (their ground floor is the 1st; their first & second floor
  plan serves the 2nd and 3rd; their sixth is the 7th). Windows too wide for the as-built wall are narrowed to fit.
- Where the plans editor has a layout with external walls (the 1st floor), its walls, windows and doors are used
  instead; rough layouts that trace the outside walls as partitions give way to the facade.
- Glass balustrades, a white band at every slab edge, soffit downlights, the roof parapet, the ground-floor lift lobbies
  with their entrance doors, and set dressing (cars, palms on the roof terraces, parasols on the pool deck).
- Two looks: *Like the renders* (white, frames matt black, glass lit warm, sky and shadows) and *Engineering* (see-through
  skin over the structure coloured by the checks).
- Below ground (the *Below ground* view cuts the building away above the ground floor slab): the raft drawn at its
  as-built depth (top -1.35, on rock about 2 m down), the basement (storage on B-C with its stair, and the water tank
  C-D / 3-5) inside 300 mm retaining walls on its 450 mm raft, the stub columns and lift pits down to the raft, and the
  ground floor slab. As built the basement is about 2.3 m high inside, so its floor is at -2.20, 0.85 m below the rest
  of the raft. Levels in `loads.json` > `foundation` > `raft` > `shown_at_mm`, the basement in `foundation` >
  `basement`; the analysis still has the raft right under the ground floor.
- Getting round: drag to orbit, or fly with the keys: W/S forward and back along the view, A/D sideways, Q/E down and
  up, the arrows to look up, down, left and right, Shift to go faster.

## Drawing sheets

A floor's as-built setting-out plan for the structural engineer: an A1 sheet at 1:100 (PDF) with the grid, slab edges,
columns, walls, lift cores, stairs and openings set out from the grid lines, schedules, what differs from the drawing,
and the columns of the floor below where they sit off; plus the same plan as a DXF (mm, 1:1, on layers) for CAD.

```
node structure/tools/export-sheet.ts asbuilt_live.json 2 > structure/private/sheets/sheet-2.json
python3 structure/tools/draw_sheet.py structure/private/sheets/sheet-2.json structure/private/sheets/LEX-AB-02
```

`export-sheet.ts` reads the as-built documents with the as-built app's own geometry code; `draw_sheet.py` needs
`pip install reportlab ezdxf`. The sheets are made from the live record, so they stay in the git-ignored private folder.

## Analyses and checks

- Gravity: self-weight, finishes and walls, imposed load. Every reaction adds back to the applied load.
- Wind: EN 1991-1-4, Accra 20 m/s (10-min mean), terrain III, with torsion e = b/10.
- Earthquake: EN 1998-1 response spectrum (modes from the floors condensed to x, y and twist, CQC), accidental
  torsion, Ex + 0.3Ey. Ghana Building Code level 0.35 g, with 0.20 g as a sensitivity.
- Columns and walls: EN 1992-1-1 biaxial strain-compatibility capacity with the R10 bars, imperfection and
  second-order effects (nominal curvature); the steel needed is worked out for every column.
- Lift cores: section forces at each storey, vertical steel needed.
- Beams: bending (with compression steel where needed) and shear (variable strut angle).
- Raft: soil pressure against the 400 kPa bearing figure, settlement and distortion, uplift in the earthquake,
  bending steel (Wood-Armer) and punching under every column, wall and core (EN 1992-1-1 6.4.4), with the thickness
  each support needs. With `type: pads`: pad sizes and the R10 bases instead.
- The 2nd floor's flat slab: punching at every column, with and without the engineer's link cages.
- Drift, P-delta (theta) and the torsional-flexibility check.

## Not in yet

- The plan walls as line loads (the internal walls are an even 2.5 kPa).
- Window sills and heads as built (the schedule's 0.9 m / 2.1 m are used); doors onto the balconies.
- Engineer's drawings for floors 5-7 and the roof (the 4th floor's slab and beams are used).
- Beam and slab reinforcement as drawn (the steel needed is reported instead).
- In the analysis, the raft's real level and the stub columns between it and the ground floor (they are drawn in the
  viewer); the soil stiffness from the geotech report; the basement floor's as-built level.
- Capacity design (strong column / weak beam) and detailing rules of EN 1998-1 chapter 5.
