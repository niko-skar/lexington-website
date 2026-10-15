import { NextResponse } from "next/server";

import { boxTitle, gridRef, when } from "@/lib/asbuilt/format";
import { boxOf, centreOf, edgePos, gapsOf } from "@/lib/asbuilt/geometry";
import { isRealRecord, readAllFloorsFull } from "@/lib/asbuilt/store";
import type { BoxEl, BoxList, Faces, Floor } from "@/lib/asbuilt/types";
import { getAdminSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Downloads of the whole as-built record: a spreadsheet (one row per
 * measurement, drawing against as built) or the full backup (every floor with
 * its complete change history), for drawing the as-built floor plans later.
 */

const HEAD = [
  "Floor",
  "Item",
  "Grid",
  "Measurement",
  "Drawing (mm)",
  "As built (mm)",
  "Difference (mm)",
  "Measured",
  "Note",
];

function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const t = typeof v === "number" ? String(Math.round(v * 10) / 10) : v;
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

const FACE_WORDS: Record<keyof Faces, string> = { l: "Left face", r: "Right face", t: "Top face", b: "Bottom face" };

function floorRows(floor: Floor): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [];
  const diff = (a: number | null, d: number | null) => (a === null || d === null ? null : a - d);

  for (const gap of [...gapsOf(floor, "x"), ...gapsOf(floor, "y")]) {
    const built = gap.measured || gap.actual !== gap.design ? gap.actual : null;
    rows.push([
      floor.name,
      `Grid ${gap.from.id} to ${gap.to.id}`,
      `${gap.from.id}-${gap.to.id}`,
      "Spacing",
      gap.design,
      built,
      diff(built, gap.design),
      "",
      "",
    ]);
  }

  const lists: BoxList[] = ["columns", "cores", "openings"];
  for (const list of lists) {
    for (const el of floor[list] as BoxEl[]) {
      const name = boxTitle(list, el);
      const at = el.at ? when(el.at) : "";
      const note = el.note ?? ("removed" in el && el.removed ? "Marked not built" : "");
      for (const f of ["l", "r", "t", "b"] as const) {
        const line = f === "l" || f === "r" ? el.x : el.y;
        const d = el.design ? el.design[f] : null;
        const a = el.actual ? el.actual[f] : null;
        rows.push([floor.name, name, gridRef(el), `${FACE_WORDS[f]} from grid ${line} (+ = ${f === "l" || f === "r" ? "right" : "down"})`, d, a, diff(a, d), at, note]);
      }
      if (list === "cores") {
        const d = el.design ? (el.design as { wall: number }).wall : null;
        const a = el.actual ? (el.actual as { wall: number }).wall : null;
        rows.push([floor.name, name, gridRef(el), "Wall thickness", d, a, diff(a, d), at, note]);
      }
      const db = el.design ? boxOf(floor, el, "design") : null;
      const ab = el.actual ? boxOf(floor, el, "actual") : null;
      const dc = db ? centreOf(db) : null;
      const ac = ab ? centreOf(ab) : null;
      rows.push([
        floor.name,
        name,
        gridRef(el),
        "Centre, mm right of grid B",
        dc?.[0] ?? null,
        ac?.[0] ?? null,
        diff(ac?.[0] ?? null, dc?.[0] ?? null),
        at,
        "",
      ]);
      rows.push([
        floor.name,
        name,
        gridRef(el),
        "Centre, mm below grid 2",
        dc?.[1] ?? null,
        ac?.[1] ?? null,
        diff(ac?.[1] ?? null, dc?.[1] ?? null),
        at,
        "",
      ]);
    }
  }

  for (const edge of floor.slab?.edges ?? []) {
    const built = edge.actual ?? null;
    const absD = edgePos(floor, edge, "design");
    const absA = built === null ? null : edgePos(floor, edge, "actual");
    rows.push([
      floor.name,
      "Slab edge",
      edge.ref,
      `Edge ${edge.axis === "x" ? "across" : "down"} from grid ${edge.ref} (+ = ${edge.axis === "x" ? "right" : "down"})`,
      edge.design,
      built,
      diff(absA, absD),
      edge.at ? when(edge.at) : "",
      edge.note ?? "",
    ]);
  }
  return rows;
}

export async function GET(request: Request) {
  if (!(await getAdminSession())) return new NextResponse("Not signed in.", { status: 401 });
  const format = new URL(request.url).searchParams.get("format") === "json" ? "json" : "csv";
  const floors = await readAllFloorsFull();
  const stamp = new Date().toISOString().slice(0, 10);
  const tag = isRealRecord() ? "" : " (test copy)";

  if (format === "json") {
    return new NextResponse(JSON.stringify({ exportedAt: new Date().toISOString(), floors }, null, 1), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="Lexington as-built backup ${stamp}${tag}.json"`,
        "cache-control": "no-store",
      },
    });
  }

  const lines = [HEAD.map(cell).join(",")];
  for (const floor of floors) for (const row of floorRows(floor)) lines.push(row.map(cell).join(","));
  // The byte-order mark makes Excel read the "×" and "–" correctly.
  return new NextResponse(`﻿${lines.join("\r\n")}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="Lexington as-built ${stamp}${tag}.csv"`,
      "cache-control": "no-store",
    },
  });
}
