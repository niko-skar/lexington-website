// One floor of the as-built record, worked out with the as-built app's own geometry code
// (lexington-site/lib/asbuilt/geometry.ts), for a setting-out drawing sheet: grid lines as drawn and as built, every
// slab edge with the grid line it is set out from, columns, walls, lift cores and openings (as built, as drawn, and
// whether and how far off they were measured), the fixed point, and the columns of the floor below.
//
//   node structure/tools/export-sheet.ts asbuilt_live.json 2 > structure/private/sheet-2.json
//
// asbuilt_live.json: the as-built documents (the admin page's full backup, or the raw asbuiltFloor documents).
import { readFileSync } from "node:fs";
import {
  boxOf,
  boxStatus,
  deviationOf,
  edgeDeviation,
  edgeMeasured,
  edgePos,
  edgeSegment,
  fixedColumnOf,
  gridLines,
  isMeasured,
  linePos,
  slabCorners,
} from "../../lexington-site/lib/asbuilt/geometry.ts";
import { DEFAULT_TOLERANCE } from "../../lexington-site/lib/asbuilt/types.ts";

const [path, key] = process.argv.slice(2);
if (!path || !key) {
  console.error("usage: export-sheet.ts asbuilt_live.json <floor key>");
  process.exit(1);
}
const raw = JSON.parse(readFileSync(path, "utf8"));
const floors: any[] = (Array.isArray(raw) ? raw : raw.floors ?? raw.result ?? []).slice().sort((a: any, b: any) => a.order - b.order);
const i = floors.findIndex((f) => f.key === key);
if (i < 0) {
  console.error(`no floor ${key}`);
  process.exit(1);
}
const f = floors[i];
const below = i > 0 ? floors[i - 1] : null;
const r1 = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v * 10) / 10);
const box = (b: any) => (b ? [r1(b.x0), r1(b.y0), r1(b.x1), r1(b.y1)] : null);
const tol = DEFAULT_TOLERANCE;

const grid = (fl: any, axis: "x" | "y") =>
  gridLines(fl, axis).map((g: any) => ({ id: g.id, design: g.design, actual: r1(linePos(fl, axis, g.id, "actual") ?? g.design), measured: !!g.measured }));

const corners = slabCorners(f, "actual");
const cornersDesign = slabCorners(f, "design");
const edges = (f.slab?.edges ?? []).map((e: any, k: number) => ({
  key: e._key,
  axis: e.axis,
  ref: e.ref,
  // positions are absolute (mm from grid B across, from grid 2 down); offsets are from the ref line
  design: r1(edgePos(f, e, "design")),
  actual: r1(edgePos(f, e, "actual")),
  offset_design: e.design,
  offset_actual: r1((edgePos(f, e, "actual") ?? 0) - (linePos(f, e.axis, e.ref, "actual") ?? 0)),
  measured: edgeMeasured(f, e),
  deviation: r1(edgeDeviation(f, e)),
  note: e.note ?? null,
  segment: corners ? edgeSegment(corners, k).map(([x, y]: number[]) => [r1(x), r1(y)]) : null,
}));

const boxes = (fl: any, list: "columns" | "cores" | "openings") =>
  (fl[list] ?? [])
    .filter((el: any) => !el.removed)
    .map((el: any) => ({
      key: el._key,
      name: el.name,
      kind: el.kind ?? (list === "cores" ? "core" : "column"),
      ref: `${el.x}/${el.y}`,
      x: el.x,
      y: el.y,
      box: box(boxOf(fl, el, "actual")),
      design: el.design ? box(boxOf(fl, el, "design")) : null,
      measured: isMeasured(el),
      status: boxStatus(fl, el, tol),
      deviation: deviationOf(fl, el),
      ends: !!el.ends,
      added: !!el.added,
      wall: list === "cores" ? (el.actual ?? el.design)?.wall ?? null : undefined,
      door: el.door ?? undefined,
      note: el.note ?? null,
      at: el.at ?? null,
    }));

const fixed = fixedColumnOf(f);
process.stdout.write(
  JSON.stringify(
    {
      source: path,
      exported: new Date().toISOString(),
      tolerance: tol,
      floor: { key: f.key, name: f.name, short: f.short, level: f.level, source: f.source, notes: f.notes ?? [], updated: f._updatedAt ?? null },
      grid: { x: grid(f, "x"), y: grid(f, "y") },
      corners: corners?.map(([x, y]: number[]) => [r1(x), r1(y)]) ?? null,
      corners_design: cornersDesign?.map(([x, y]: number[]) => [r1(x), r1(y)]) ?? null,
      edges,
      columns: boxes(f, "columns"),
      cores: boxes(f, "cores"),
      openings: boxes(f, "openings"),
      fixed: fixed ? fixed._key : null,
      below: below
        ? { key: below.key, name: below.name, level: below.level, grid: { x: grid(below, "x"), y: grid(below, "y") }, columns: boxes(below, "columns"), cores: boxes(below, "cores") }
        : null,
    },
    null,
    1,
  ),
);
