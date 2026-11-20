// The plans editor's floor layouts (walls, doors, windows, rooms, homes) as positions in mm, worked out with the
// plans editor's own geometry code (lexington-site/lib/plans/geometry.ts) on the as-built record, so every wall sits
// where the plans page draws it: hung on grid lines, slab edges and column faces as built.
//
//   node --import ./structure/tools/alias.mjs structure/tools/export-plans.ts plans_live.json [asbuilt_live.json] \
//        > structure/model/plans.json
//
// plans_live.json: the floorPlanOption documents (walls, openings, labels). asbuilt_live.json: the as-built floors
// (the as-built page's full backup, or the raw asbuiltFloor documents); without it, the seed (drawing figures).
import { readFileSync } from "node:fs";
import { analysePlan } from "../../lexington-site/lib/plans/geometry.ts";

const [plansPath, asbuiltPath] = process.argv.slice(2);
if (!plansPath) {
  console.error("usage: export-plans.ts plans_live.json [asbuilt_live.json]");
  process.exit(1);
}
const rawPlans = JSON.parse(readFileSync(plansPath, "utf8"));
const plans: any[] = Array.isArray(rawPlans) ? rawPlans : rawPlans.result ?? rawPlans.plans ?? [];
const rawFloors = JSON.parse(readFileSync(asbuiltPath ?? new URL("../../lexington-site/lib/asbuilt/seed.json", import.meta.url), "utf8"));
const floors: any[] = Array.isArray(rawFloors) ? rawFloors : rawFloors.result ?? rawFloors.floors ?? [];
const r = (v: number) => Math.round(v);

const out: any[] = [];
for (const plan of [...plans].sort((a, b) => `${a.floorKey}-${a.option}`.localeCompare(`${b.floorKey}-${b.option}`))) {
  const floor = floors.find((f) => f.key === plan.floorKey);
  if (!floor) continue;
  const a = analysePlan(floor, { walls: plan.walls ?? [], labels: plan.labels ?? [] });
  const byKey = new Map(a.walls.map((w) => [w.key, w]));
  const openings = (plan.openings ?? [])
    .map((o: any) => {
      const w = byKey.get(o.wall);
      if (!w) return null;
      const s = w.aFirst ? w.s0 + o.at : w.s1 - o.at; // the opening's middle along the wall
      return { wall: o.wall, kind: o.kind, at: r(s), w: r(o.w), flip: !!o.flip, hand: !!o.hand };
    })
    .filter(Boolean);
  out.push({
    floorKey: plan.floorKey,
    option: plan.option,
    name: plan.name,
    updatedAt: plan.updatedAt ?? null,
    walls: a.walls.map((w) => ({ key: w.key, kind: w.kind, t: r(w.t), dir: w.dir, c: r(w.c), s0: r(w.s0), s1: r(w.s1) })),
    openings,
    rooms: a.rooms.map((rm) => ({
      area: rm.area, open: rm.open, name: rm.label?.name ?? null, type: rm.label?.type ?? null, unit: rm.label?.unit ?? null,
      loops: rm.loops.map((l) => l.map(([x, y]) => [r(x), r(y)])), spot: [r(rm.spot[0]), r(rm.spot[1])],
    })),
    homes: a.homes.map((h) => ({ unit: h.unit, nia: h.nia, outdoor: h.outdoor, columns: h.columns, loops: h.loops.map((l) => l.map(([x, y]) => [r(x), r(y)])) })),
    common: a.common,
    problems: a.problems.map((p) => p.text),
  });
}
process.stdout.write(
  JSON.stringify({ source: { plans: plansPath, asbuilt: asbuiltPath ?? "seed (drawing figures)" }, exported: new Date().toISOString(), options: out }, null, 1),
);
