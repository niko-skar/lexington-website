import { notFound } from "next/navigation";

import { PrintButton } from "@/components/plans/PrintButton";
import { boxOf, type Box } from "@/lib/asbuilt/geometry";
import { readFloors } from "@/lib/asbuilt/store";
import type { BoxEl } from "@/lib/asbuilt/types";
import { requireAdminPage } from "@/lib/auth/requireAdmin";
import { againstStated, analysePlan, isOutdoor, wallRect, type P } from "@/lib/plans/geometry";
import { readPlans } from "@/lib/plans/store";
import { client } from "@/lib/sanity/client";

import s from "./print.module.css";

export const metadata = { title: "Home plan | The Lexington" };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const m = (mm: number) => (mm / 1000).toFixed(2);

/**
 * One home's dimensioned plan with its net internal area, to print or save as a PDF (the sale
 * agreement's annex needs "the dimensioned floor plan of the Unit showing its Net Internal Area").
 */
export default async function PrintHomePage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAdminPage();
  const params = await searchParams;
  const floorKey = one(params.floor);
  const option = one(params.option);
  const unit = one(params.unit).toUpperCase();
  const [floors, plans, units] = await Promise.all([
    readFloors(),
    readPlans(),
    client.fetch<{ unit: string; areaSqm: number }[]>(`*[_type == "unit"]{ "unit": unitNumber, areaSqm }`),
  ]);
  const floor = floors.find((f) => f.key === floorKey);
  const plan = plans.find((p) => p.floorKey === floorKey && p.option === option);
  if (!floor || !plan) notFound();
  const a = analysePlan(floor, { walls: plan.walls ?? [], labels: plan.labels ?? [] });
  const home = a.homes.find((h) => h.unit === unit);
  if (!home) notFound();

  // The home's outline, with room around it for the dimensions.
  const pts = [...home.loops.flat(), ...home.rooms.flatMap((r) => r.loops.flat())];
  const ext: Box = {
    x0: Math.min(...pts.map((p) => p[0])),
    x1: Math.max(...pts.map((p) => p[0])),
    y0: Math.min(...pts.map((p) => p[1])),
    y1: Math.max(...pts.map((p) => p[1])),
  };
  const nia: Box = {
    x0: Math.min(...home.loops.flat().map((p) => p[0])),
    x1: Math.max(...home.loops.flat().map((p) => p[0])),
    y0: Math.min(...home.loops.flat().map((p) => p[1])),
    y1: Math.max(...home.loops.flat().map((p) => p[1])),
  };
  const pad = 1600;
  const view = { x: ext.x0 - pad, y: ext.y0 - pad, w: ext.x1 - ext.x0 + pad * 2, h: ext.y1 - ext.y0 + pad * 2 };
  const near = (b: Box) => b.x1 > view.x && b.x0 < view.x + view.w && b.y1 > view.y && b.y0 < view.y + view.h;
  const path = (loops: P[][]) => loops.map((l) => `M${l.map(([x, y]) => `${x} ${y}`).join("L")}Z`).join("");
  const stated = (plan.targets ?? []).find((t) => t.unit === unit)?.stated ?? units.find((u) => u.unit.toUpperCase() === unit)?.areaSqm ?? null;
  const diff = againstStated(home.nia, stated);
  const fs = view.w / 70; // text size in mm, so the page reads at any home's size
  const dimOff = 700;

  return (
    <div className={s.page}>
      <style>{`@media print { header, nav { display: none !important; } }`}</style>
      <div className={s.noPrint}>
        <PrintButton />
        <span>Print it, or save it as a PDF, on A4 landscape.</span>
      </div>
      <div className={s.sheet}>
        <svg viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} className={s.plan} role="img" aria-label={`Plan of ${unit}`}>
          {(["columns", "cores"] as const).map((list) =>
            (floor[list] as BoxEl[]).map((el) => {
              const b = boxOf(floor, el, "actual");
              return b && near(b) ? <rect key={`${list}${el._key}`} x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} className={s.structure} /> : null;
            }),
          )}
          {home.rooms.map((r) => (
            <path key={r.id} d={path(r.loops)} className={isOutdoor(r.label?.type) ? s.outdoor : s.room} fillRule="evenodd" />
          ))}
          <path d={path(home.loops)} className={s.niaEdge} fillRule="evenodd" strokeWidth={fs / 6} />
          {a.walls.map((w) => {
            const b = wallRect(w, a.walls);
            return near(b) ? <rect key={w.key} x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} className={s[`wall_${w.kind}`]} /> : null;
          })}
          {(plan.openings ?? []).map((o) => {
            const w = a.walls.find((x) => x.key === o.wall);
            if (!w) return null;
            const c = w.aFirst ? w.s0 + o.at : w.s1 - o.at;
            const t = w.t + 4;
            const r = w.dir === "h" ? { x: c - o.w / 2, y: w.c - t / 2, width: o.w, height: t } : { x: w.c - t / 2, y: c - o.w / 2, width: t, height: o.w };
            return <rect key={o._key} {...r} className={o.kind === "window" ? s.window : s.door} />;
          })}
          {home.rooms.map((r) => {
            if (!r.label) return null;
            const [x, y] = r.spot;
            return (
              <g key={`t${r.id}`} className={s.text} style={{ fontSize: fs }}>
                <text x={x} y={y - fs * 0.7}>
                  {r.label.name}
                </text>
                <text x={x} y={y + fs * 0.5} className={s.small}>
                  {m(r.box.x1 - r.box.x0)} × {m(r.box.y1 - r.box.y0)} m
                </text>
                <text x={x} y={y + fs * 1.6} className={s.small}>
                  {r.area.toFixed(2)} m²
                </text>
              </g>
            );
          })}
          {/* Overall: the net internal width and depth. */}
          <g className={s.dim} style={{ fontSize: fs * 0.95 }} strokeWidth={fs / 10}>
            <line x1={nia.x0} x2={nia.x1} y1={ext.y0 - dimOff} y2={ext.y0 - dimOff} />
            <line x1={nia.x0} x2={nia.x0} y1={ext.y0 - dimOff - fs / 2} y2={ext.y0 - dimOff + fs / 2} />
            <line x1={nia.x1} x2={nia.x1} y1={ext.y0 - dimOff - fs / 2} y2={ext.y0 - dimOff + fs / 2} />
            <text x={(nia.x0 + nia.x1) / 2} y={ext.y0 - dimOff - fs * 0.5}>
              {m(nia.x1 - nia.x0)} m
            </text>
            <line y1={nia.y0} y2={nia.y1} x1={ext.x0 - dimOff} x2={ext.x0 - dimOff} />
            <line y1={nia.y0} y2={nia.y0} x1={ext.x0 - dimOff - fs / 2} x2={ext.x0 - dimOff + fs / 2} />
            <line y1={nia.y1} y2={nia.y1} x1={ext.x0 - dimOff - fs / 2} x2={ext.x0 - dimOff + fs / 2} />
            <text x={ext.x0 - dimOff - fs * 0.5} y={(nia.y0 + nia.y1) / 2} transform={`rotate(-90 ${ext.x0 - dimOff - fs * 0.5} ${(nia.y0 + nia.y1) / 2})`}>
              {m(nia.y1 - nia.y0)} m
            </text>
          </g>
          {/* A scale bar: 5 m. */}
          <g className={s.scale} strokeWidth={fs / 10}>
            <line x1={view.x + pad * 0.4} x2={view.x + pad * 0.4 + 5000} y1={view.y + view.h - pad * 0.35} y2={view.y + view.h - pad * 0.35} />
            {[0, 1000, 2000, 3000, 4000, 5000].map((t) => (
              <line key={t} x1={view.x + pad * 0.4 + t} x2={view.x + pad * 0.4 + t} y1={view.y + view.h - pad * 0.35 - fs / 3} y2={view.y + view.h - pad * 0.35 + fs / 3} />
            ))}
            <text x={view.x + pad * 0.4 + 2500} y={view.y + view.h - pad * 0.35 - fs * 0.6} style={{ fontSize: fs * 0.8 }}>
              0–5 m
            </text>
          </g>
        </svg>
        <div className={s.info}>
          <div className={s.unit}>{unit}</div>
          <div className={s.where}>
            The Lexington, Shiashie, East Legon · {floor.name}
          </div>
          <table className={s.areas}>
            <tbody>
              <tr>
                <th>Net internal area</th>
                <td>{home.nia.toFixed(2)} m²</td>
              </tr>
              {home.outdoor > 0 && (
                <tr>
                  <th>Balcony / terrace (not in the net internal area)</th>
                  <td>{home.outdoor.toFixed(2)} m²</td>
                </tr>
              )}
              {stated && (
                <tr>
                  <th>Stated</th>
                  <td>
                    {stated} m² ({diff !== null && diff > 0 ? "+" : ""}
                    {diff?.toFixed(1)}%)
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className={s.note}>
            Net internal area: the internal floor area measured to the internal face of the enclosing walls, excluding balconies, terraces,
            external storage and any part of the common areas. Measured on the as-built record of the {floor.name.toLowerCase()} (columns and
            slab edges as built), layout &ldquo;{plan.name}&rdquo;{plan.updatedAt ? ` of ${new Date(plan.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}` : ""}.
            Room sizes are the largest width and depth of each room. Dimensions in metres.
          </p>
        </div>
      </div>
    </div>
  );
}
