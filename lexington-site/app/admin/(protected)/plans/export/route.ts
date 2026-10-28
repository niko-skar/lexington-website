import { NextResponse } from "next/server";

import { readFloors } from "@/lib/asbuilt/store";
import { getAdminSession } from "@/lib/auth/session";
import { againstStated, analysePlan, toleranceBand } from "@/lib/plans/geometry";
import { readPlans } from "@/lib/plans/store";
import { client } from "@/lib/sanity/client";

/**
 * GET /admin/plans/export: the areas of a floor's layout (or of every floor's first layout) as a
 * spreadsheet (CSV): each home's net internal area, balcony, what it is sold as and the difference,
 * then every room.
 */
export async function GET(request: Request) {
  if (!(await getAdminSession())) return new NextResponse("Not signed in.", { status: 401 });
  const url = new URL(request.url);
  const floorKey = url.searchParams.get("floor");
  const option = url.searchParams.get("option");
  const [floors, plans, units] = await Promise.all([
    readFloors(),
    readPlans(),
    client.fetch<{ unit: string; areaSqm: number }[]>(`*[_type == "unit"]{ "unit": unitNumber, areaSqm }`),
  ]);
  const website = new Map(units.map((u) => [u.unit.toUpperCase(), u.areaSqm]));
  const chosen = floorKey
    ? plans.filter((p) => p.floorKey === floorKey && (!option || p.option === option))
    : floors.map((f) => plans.filter((p) => p.floorKey === f.key).sort((a, b) => a.option.localeCompare(b.option))[0]).filter(Boolean);

  const rows: (string | number | null)[][] = [
    ["Floor", "Layout", "Home", "Net internal area m²", "Balcony / terrace m²", "Of which free columns m²", "Sold as m²", "Difference %", "Clause 2.4"],
  ];
  const roomRows: (string | number | null)[][] = [["Floor", "Layout", "Room", "Type", "Home", "Area m²"]];
  for (const plan of chosen) {
    const floor = floors.find((f) => f.key === plan.floorKey);
    if (!floor) continue;
    const a = analysePlan(floor, { walls: plan.walls ?? [], labels: plan.labels ?? [] });
    for (const h of a.homes) {
      const stated = (plan.targets ?? []).find((t) => t.unit === h.unit)?.stated ?? website.get(h.unit) ?? null;
      const diff = againstStated(h.nia, stated);
      const band = toleranceBand(diff);
      rows.push([
        floor.name,
        plan.name,
        h.unit,
        h.nia,
        h.outdoor || null,
        h.columns || null,
        stated,
        diff,
        band === "ok" ? "within 3%: no change" : band === "adjust" ? "3-7%: price moves pro rata" : band === "rescind" ? "over 7% smaller: buyer may rescind" : "",
      ]);
    }
    for (const r of a.rooms) {
      if (!r.label) continue;
      roomRows.push([floor.name, plan.name, r.label.name, r.label.type, r.label.unit ?? "shared", r.area]);
    }
  }
  const cell = (v: string | number | null) => {
    if (v === null || v === undefined) return "";
    const t = String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const csv = [...rows, [], ...roomRows].map((r) => r.map(cell).join(",")).join("\r\n");
  const name = `lexington-areas-${floorKey ?? "all"}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(`﻿${csv}`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
}
