"use client";

import { Fragment, useState } from "react";

import { boxTitle, gridRef, mm, moveText, offsetText } from "@/lib/asbuilt/format";
import { floorBelow, setOutLines, setOutRows, type SetOutLine, type SetOutRow } from "@/lib/asbuilt/setout";
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
  drawing: "On its grid lines as built: the one below isn't measured yet",
  "nothing-below": "Drawing: nothing below it",
};

function csvCell(v: string | number): string {
  const t = String(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

const sizeText = (r: SetOutRow) => `${mm(r.target.r - r.target.l)} × ${mm(r.target.b - r.target.t)}`;

function LineBlock({ line, onSelect }: { line: SetOutLine; onSelect: (sel: Selection) => void }) {
  const first = line.first;
  const arrow = line.axis === "x" ? "↔" : "↕";
  const start =
    line.axis === "x"
      ? `left face ${offsetText("x", first.target.l, first.el.x)}`
      : `top face ${offsetText("y", first.target.t, first.el.y)}`;
  const name = (r: SetOutRow) => (
    <button type="button" className={s.lineName} onClick={() => onSelect({ kind: "box", list: r.list, key: r.key })}>
      {boxTitle(r.list, r.el)}
    </button>
  );
  // Only the ones that follow a measured column below get a mark; the rest stand on their grid lines as built.
  const from = (r: SetOutRow) => (r.basis === "measured" ? <span className={s.soBuilt}>on the one below</span> : null);
  const all = [first, ...line.links.map((l) => l.next)];
  const built = all.filter((r) => r.basis === "measured").length;
  return (
    <div className={s.soLine}>
      <div className={s.soLineHead}>
        {line.axis === "x" ? `Along grid ${line.lineId}` : `Down grid ${line.lineId}`}
        <small>
          {built === 0
            ? "nothing below measured yet: on the grid lines as built"
            : built === all.length
              ? "all on the columns below, as built"
              : `${built} of ${all.length} on the columns below, the rest on their grid lines as built`}
        </small>
      </div>
      <ol className={s.soList}>
        <li className={s.soItem}>
          {name(first)}
          <span className={s.soSize}>{sizeText(first)}</span>
          <span className={s.soStart}>Start: {start}</span>
          {from(first)}
        </li>
        {line.links.map((link) => {
          const differs = Math.round(link.gap) !== Math.round(link.drawn);
          return (
            <Fragment key={link.next.key}>
              <li className={s.soGap}>
                <span className={s.lineArrow} aria-hidden="true">
                  {arrow}
                </span>
                <span>
                  <b style={differs ? { color: "var(--brass-text)" } : undefined}>{mm(link.gap)}</b> face to face
                  <small>
                    {mm(link.cc)} centre to centre{differs ? ` · drawing ${mm(link.drawn)}` : ""}
                  </small>
                </span>
              </li>
              <li className={s.soItem}>
                {name(link.next)}
                <span className={s.soSize}>{sizeText(link.next)}</span>
                {from(link.next)}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </div>
  );
}

export function SetOutView({ floors, floor, tol, pullBack, onTol, onPullBack, onSelect }: Props) {
  const [mode, setMode] = useState<"lines" | "faces">("lines");
  const below = floorBelow(floors, floor);
  const rows = setOutRows(floor, below, tol, pullBack);
  const rowLines = setOutLines(floor, rows, "x");
  const colLines = setOutLines(floor, rows, "y");
  const counts = {
    measured: rows.filter((r) => r.basis === "measured").length,
    drawing: rows.filter((r) => r.basis === "drawing").length,
    none: rows.filter((r) => r.basis === "nothing-below").length,
  };

  const downloadLines = () => {
    const head = [
      "Line",
      "From",
      "To",
      "Gap face to face",
      "Centre to centre",
      "Drawing gap",
      "Size of the new one",
      "Start",
    ];
    const out: string[] = [];
    for (const line of [...rowLines, ...colLines]) {
      const label = line.axis === "x" ? `Along grid ${line.lineId}` : `Down grid ${line.lineId}`;
      const f = line.first;
      const start =
        line.axis === "x"
          ? `left face ${offsetText("x", f.target.l, f.el.x)}`
          : `top face ${offsetText("y", f.target.t, f.el.y)}`;
      out.push(
        [label, "", boxTitle(f.list, f.el), "", "", "", sizeText(f).replace("×", "x"), start].map(csvCell).join(","),
      );
      for (const link of line.links) {
        out.push(
          [
            label,
            boxTitle(link.prev.list, link.prev.el),
            boxTitle(link.next.list, link.next.el),
            mm(link.gap),
            mm(link.cc),
            mm(link.drawn),
            sizeText(link.next).replace("×", "x"),
            "",
          ]
            .map(csvCell)
            .join(","),
        );
      }
    }
    const blob = new Blob([`\ufeff${[head.join(","), ...out].join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Lexington set-out ${floor.name} (between columns).csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const download = () => {
    if (mode === "lines") return downloadLines();
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

      <div className={s.row} style={{ marginBottom: 12 }}>
        <span className={s.side} role="group" aria-label="Show the set-out">
          <button
            type="button"
            className={mode === "lines" ? s.sideOn : s.sideBtn}
            aria-pressed={mode === "lines"}
            onClick={() => setMode("lines")}
          >
            Between columns
          </button>
          <button
            type="button"
            className={mode === "faces" ? s.sideOn : s.sideBtn}
            aria-pressed={mode === "faces"}
            onClick={() => setMode("faces")}
          >
            From the grid lines
          </button>
        </span>
      </div>

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
            <strong>{counts.drawing}</strong> stand on their grid lines as built (the one below isn&rsquo;t measured yet)
          </span>
          {counts.none > 0 && (
            <span>
              <strong>{counts.none}</strong> have nothing below
            </span>
          )}
        </div>
      )}

      {mode === "lines" && (
        <>
          {rowLines.length > 0 && (
            <section className={s.group}>
              <h3 className={s.groupTitle}>
                Along each numbered line <small>first one from the string line, then each gap</small>
              </h3>
              <div className={s.soLines}>
                {rowLines.map((line) => (
                  <LineBlock key={line.lineId} line={line} onSelect={onSelect} />
                ))}
              </div>
            </section>
          )}
          {colLines.length > 0 && (
            <section className={s.group}>
              <h3 className={s.groupTitle}>
                Down each lettered line <small>top to bottom</small>
              </h3>
              <div className={s.soLines}>
                {colLines.map((line) => (
                  <LineBlock key={line.lineId} line={line} onSelect={onSelect} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {mode === "faces" && rows.length > 0 && (
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
      ) : mode === "lines" ? null : (
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
