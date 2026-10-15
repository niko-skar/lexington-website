"use client";

import { boxTitle, gridRef, mm, moveText, offsetText } from "@/lib/asbuilt/format";
import { floorBelow, setOutRows, type SetOutRow } from "@/lib/asbuilt/setout";
import type { Floor, Selection, Tolerance } from "@/lib/asbuilt/types";

import s from "./AsBuilt.module.css";

interface Props {
  floors: Floor[];
  floor: Floor;
  tol: Tolerance;
  pullBack: number;
  onTol: (tol: Tolerance) => void;
  onPullBack: (v: number) => void;
  onSelect: (sel: Selection) => void;
}

const BASIS: Record<SetOutRow["basis"], string> = {
  measured: "Sits on the one below, as built",
  drawing: "Drawing: the one below isn't measured yet",
  "nothing-below": "Drawing: nothing below it",
};

function csvCell(v: string | number): string {
  const t = String(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export function SetOutView({ floors, floor, tol, pullBack, onTol, onPullBack, onSelect }: Props) {
  const below = floorBelow(floors, floor);
  const rows = setOutRows(floor, below, tol, pullBack);
  const counts = {
    measured: rows.filter((r) => r.basis === "measured").length,
    drawing: rows.filter((r) => r.basis === "drawing").length,
    none: rows.filter((r) => r.basis === "nothing-below").length,
  };

  const download = () => {
    const head = [
      "Item",
      "Grid",
      "Left face",
      "Right face",
      "Top face",
      "Bottom face",
      "Size",
      "Based on",
      "Moved from drawing",
    ];
    const lines = rows.map((r) =>
      [
        boxTitle(r.list, r.el),
        gridRef(r.el),
        offsetText("x", r.target.l, r.el.x),
        offsetText("x", r.target.r, r.el.x),
        offsetText("y", r.target.t, r.el.y),
        offsetText("y", r.target.b, r.el.y),
        `${mm(r.target.r - r.target.l)} x ${mm(r.target.b - r.target.t)}`,
        r.drawnStep
          ? `${BASIS[r.basis]}. The drawings put it ${moveText(r.drawnStep.dx, r.drawnStep.dy)} from the one below`
          : BASIS[r.basis],
        moveText(r.shift.dx, r.shift.dy),
      ]
        .map(csvCell)
        .join(","),
    );
    const blob = new Blob([`﻿${[head.join(","), ...lines].join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Lexington set-out ${floor.name}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const num = (text: string, fallback: number) => {
    const v = Number(text);
    return Number.isFinite(v) && v >= 0 ? Math.round(v) : fallback;
  };

  return (
    <div>
      <p className={s.fact} style={{ marginBottom: 12, maxWidth: 820 }}>
        {below ? (
          <>
            Where to mark each column and lift core on the <strong>{floor.name}</strong> so it sits on the{" "}
            <strong>{below.name}</strong> as built. Faces are measured from this floor&rsquo;s grid lines (the string
            lines). Sizes are this floor&rsquo;s drawing sizes.
          </>
        ) : (
          <>The {floor.name} is the lowest floor in the record, so these are the drawing positions.</>
        )}
      </p>

      <div className={s.settings}>
        <label>
          Pull back towards the drawing by up to
          <input
            className={s.num}
            inputMode="numeric"
            value={pullBack}
            onChange={(e) => onPullBack(num(e.target.value, 0))}
            aria-label="Pull back per floor, mm"
          />
          mm per floor
        </label>
        <label>
          Fine up to
          <input
            className={s.num}
            inputMode="numeric"
            value={tol.ok}
            onChange={(e) => onTol({ ...tol, ok: num(e.target.value, tol.ok) })}
            aria-label="Fine up to, mm"
          />
          mm, flag over
          <input
            className={s.num}
            inputMode="numeric"
            value={tol.warn}
            onChange={(e) => onTol({ ...tol, warn: num(e.target.value, tol.warn) })}
            aria-label="Flag over, mm"
          />
          mm
        </label>
        <span className={s.row} style={{ marginLeft: "auto" }}>
          <button type="button" className={`${s.btn} ${s.btnSmall}`} onClick={download}>
            Download (Excel)
          </button>
          <button type="button" className={`${s.btn} ${s.btnSmall}`} onClick={() => window.print()}>
            Print
          </button>
        </span>
      </div>

      {below && (
        <div className={s.summary}>
          <span>
            <strong>{counts.measured}</strong> follow a measured one below
          </span>
          <span>
            <strong>{counts.drawing}</strong> use the drawing (the one below isn&rsquo;t measured yet)
          </span>
          {counts.none > 0 && (
            <span>
              <strong>{counts.none}</strong> have nothing below
            </span>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <div className={s.cards}>
          {rows.map((r) => (
            <div key={`${r.list}${r.key}`} className={s.card}>
              <button
                type="button"
                className={s.cardTitle}
                onClick={() => onSelect({ kind: "box", list: r.list, key: r.key })}
              >
                {boxTitle(r.list, r.el)}
                <span>
                  {mm(r.target.r - r.target.l)} × {mm(r.target.b - r.target.t)}
                </span>
              </button>
              <dl className={s.cardFaces}>
                <dt>Left</dt>
                <dd>{offsetText("x", r.target.l, r.el.x)}</dd>
                <dt>Right</dt>
                <dd>{offsetText("x", r.target.r, r.el.x)}</dd>
                <dt>Top</dt>
                <dd>{offsetText("y", r.target.t, r.el.y)}</dd>
                <dt>Bottom</dt>
                <dd>{offsetText("y", r.target.b, r.el.y)}</dd>
              </dl>
              <p
                className={s.cardNote}
                style={{
                  color: r.flag === "off" ? "var(--clay)" : r.flag === "warn" ? "var(--brass-text)" : undefined,
                }}
              >
                {r.shift.dx || r.shift.dy ? `Moved ${moveText(r.shift.dx, r.shift.dy)} from the drawing. ` : ""}
                {BASIS[r.basis]}.
              </p>
              {r.drawnStep && (
                <p className={s.cardNote} style={{ color: "var(--brass-text)" }}>
                  The drawings put it {moveText(r.drawnStep.dx, r.drawnStep.dy)} from the one below: check with the
                  engineer.
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <div className={s.empty}>No columns on this floor.</div>
      ) : (
        <div className={`${s.tableWrap} ${s.wideOnly}`}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Item</th>
                <th>Left face</th>
                <th>Right face</th>
                <th>Top face</th>
                <th>Bottom face</th>
                <th>Size</th>
                <th>Moved from drawing</th>
                <th>Based on</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.list}${r.key}`}>
                  <td>
                    <button
                      type="button"
                      className={s.btnQuiet}
                      style={{ padding: 0, minHeight: 0, color: "var(--ink)", fontWeight: 700 }}
                      onClick={() => onSelect({ kind: "box", list: r.list, key: r.key })}
                    >
                      {boxTitle(r.list, r.el)}
                    </button>
                  </td>
                  <td>{offsetText("x", r.target.l, r.el.x)}</td>
                  <td>{offsetText("x", r.target.r, r.el.x)}</td>
                  <td>{offsetText("y", r.target.t, r.el.y)}</td>
                  <td>{offsetText("y", r.target.b, r.el.y)}</td>
                  <td className={s.cellMuted}>
                    {mm(r.target.r - r.target.l)} × {mm(r.target.b - r.target.t)}
                  </td>
                  <td
                    className={r.flag === "off" ? s.cellStrong : undefined}
                    style={{
                      color: r.flag === "off" ? "var(--clay)" : r.flag === "warn" ? "var(--brass-text)" : undefined,
                    }}
                  >
                    {moveText(r.shift.dx, r.shift.dy)}
                  </td>
                  <td className={s.cellMuted}>
                    {BASIS[r.basis]}
                    {r.drawnStep && (
                      <span style={{ display: "block", color: "var(--brass-text)" }}>
                        The drawings put it {moveText(r.drawnStep.dx, r.drawnStep.dy)} from the one below: check with
                        the engineer.
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={s.hint} style={{ marginTop: 10 }}>
        After pouring, measure each one on the Plan or List tab: the next floor up then follows what was really built.
      </p>
    </div>
  );
}
