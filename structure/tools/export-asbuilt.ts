// Turns the as-built record into plain positions for the structural model, using the as-built
// app's own geometry code (lexington-site/lib/asbuilt/geometry.ts), so the model sits exactly where
// the as-built page draws things: taped figures where they were taped, the drawing elsewhere.
//
//   node structure/tools/export-asbuilt.ts [backup.json] > structure/model/asbuilt.json
//
// With no argument it reads the seed (the drawing only). With the as-built page's full backup
// (/admin/asbuilt/export?format=json) it uses every tape taken on site.
import { readFileSync } from "node:fs";
import { boxOf, gridLines, linePos, slabCorners, isMeasured, edgeMeasured } from "../../lexington-site/lib/asbuilt/geometry.ts";

const arg = process.argv[2];
const raw = JSON.parse(readFileSync(arg ?? new URL("../../lexington-site/lib/asbuilt/seed.json", import.meta.url), "utf8"));
const floors: any[] = (raw.floors ?? raw).slice().sort((a: any, b: any) => a.order - b.order);
const r1 = (v: number) => Math.round(v * 10) / 10;
const box = (b: any) => (b ? [r1(b.x0), r1(b.y0), r1(b.x1), r1(b.y1)] : null);

const out = floors.map((f) => {
  const grid = (axis: "x" | "y") =>
    gridLines(f, axis).map((g: any) => ({ id: g.id, design: g.design, pos: r1(linePos(f, axis, g.id, "actual") ?? g.design), measured: !!g.measured }));
  return {
    key: f.key,
    name: f.name,
    short: f.short,
    order: f.order,
    level: f.level,
    source: f.source,
    notes: f.notes ?? [],
    grid: { x: grid("x"), y: grid("y") },
    outline: slabCorners(f, "actual")?.map(([x, y]: number[]) => [r1(x), r1(y)]) ?? null,
    outlineDesign: slabCorners(f, "design")?.map(([x, y]: number[]) => [r1(x), r1(y)]) ?? null,
    edgesMeasured: (f.slab?.edges ?? []).filter((e: any) => edgeMeasured(f, e)).length,
    columns: (f.columns ?? []).map((c: any) => ({
      key: c._key, name: c.name, kind: c.kind, ref: `${c.x}/${c.y}`, ends: !!c.ends,
      box: box(boxOf(f, c, "actual")), design: box(boxOf(f, c, "design")), measured: isMeasured(c), note: c.note ?? null,
    })),
    cores: (f.cores ?? []).map((c: any) => ({
      key: c._key, name: c.name, ref: `${c.x}/${c.y}`, box: box(boxOf(f, c, "actual")), design: box(boxOf(f, c, "design")),
      wall: (c.actual ?? c.design).wall, door: c.door ?? null, measured: isMeasured(c),
    })),
    openings: (f.openings ?? []).filter((o: any) => !o.removed).map((o: any) => ({
      key: o._key, name: o.name, kind: o.kind, ref: `${o.x}/${o.y}`, box: box(boxOf(f, o, "actual")),
    })),
  };
});
process.stdout.write(JSON.stringify({ source: arg ? `backup: ${arg}` : "seed (drawing figures only)", exported: new Date().toISOString(), floors: out }, null, 1));
