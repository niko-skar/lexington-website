"use client";

import { boxTitle, gridRef, KIND_LABEL, mm, offsetText } from "@/lib/asbuilt/format";
import {
  boxOf,
  boxStatus,
  deviationOf,
  edgeDeviation,
  edgeSegment,
  gapsOf,
  gridLines,
  slabCorners,
  statusFor,
} from "@/lib/asbuilt/geometry";
import type { Axis, BoxEl, BoxList, Floor, Selection, Tolerance } from "@/lib/asbuilt/types";

import s from "./AsBuilt.module.css";
import { StatusChip } from "./Sheet";

interface Props {
  floor: Floor;
  tol: Tolerance;
  selection: Selection | null;
  onSelect: (sel: Selection) => void;
  onAddVoid: () => void;
}

function sizeText(floor: Floor, el: BoxEl): string {
  const b = boxOf(floor, el, "actual");
  return b ? `${mm(b.x1 - b.x0)} × ${mm(b.y1 - b.y0)}` : "";
}

function nearest(floor: Floor, axis: Axis, v: number): string {
  const lines = gridLines(floor, axis);
  let best = lines[0];
  for (const l of lines)
    if (Math.abs(l.design + (l.shift ?? 0) - v) < Math.abs(best.design + (best.shift ?? 0) - v)) best = l;
  return best?.id ?? "";
}

export function ListView({ floor, tol, selection, onSelect, onAddVoid }: Props) {
  const isOn = (list: BoxList, key: string) =>
    selection?.kind === "box" && selection.list === list && selection.key === key;
  const boxItem = (list: BoxList, el: BoxEl, sub: string) => {
    const dev = deviationOf(floor, el);
    const status = boxStatus(floor, el, tol);
    return (
      <button
        key={`${list}${el._key}`}
        type="button"
        className={isOn(list, el._key) ? s.itemOn : s.item}
        onClick={() => onSelect({ kind: "box", list, key: el._key })}
      >
        <span>
          <span className={s.itemName}>{boxTitle(list, el)}</span>
          <span className={s.itemSub}> · {sub}</span>
        </span>
        {"removed" in el && el.removed ? (
          <span className={s.statusNone}>Not built</span>
        ) : (
          <StatusChip status={status} worst={dev?.worst ?? null} />
        )}
      </button>
    );
  };

  const rows = gridLines(floor, "y");
  const byRow = rows
    .map((line) => ({
      line,
      items: floor.columns
        .filter((c) => c.y === line.id)
        .sort((a, b) => (boxOf(floor, a, "design")?.x0 ?? 0) - (boxOf(floor, b, "design")?.x0 ?? 0)),
    }))
    .filter((r) => r.items.length);
  const measured = [...floor.columns, ...floor.cores].filter((e) => e.actual).length;
  const total = floor.columns.length + floor.cores.length;
  const off = [...floor.columns, ...floor.cores].filter((e) => boxStatus(floor, e, tol) === "off").length;
  const corners = slabCorners(floor, "actual");

  return (
    <div>
      <div className={s.summary}>
        <span>
          <strong>
            {measured} of {total}
          </strong>{" "}
          columns, walls and lift cores measured
        </span>
        {off > 0 && (
          <span style={{ color: "var(--clay)" }}>
            <strong>{off}</strong> more than {tol.warn} mm off the drawing
          </span>
        )}
      </div>

      {byRow.map(({ line, items }) => (
        <section key={line.id} className={s.group}>
          <h3 className={s.groupTitle}>
            Along grid {line.id}{" "}
            <small>
              {items.length} {items.length === 1 ? "item" : "items"}
            </small>
          </h3>
          <div className={s.items}>
            {items.map((c) =>
              boxItem(
                "columns",
                c,
                `${c.kind === "wall" ? "wall" : "column"} ${sizeText(floor, c)}${c.ends ? " · stops above" : ""}`,
              ),
            )}
          </div>
        </section>
      ))}

      {floor.cores.length > 0 && (
        <section className={s.group}>
          <h3 className={s.groupTitle}>Lift cores</h3>
          <div className={s.items}>
            {floor.cores.map((c) => {
              const b = boxOf(floor, c, "actual");
              const wall = (c.actual ?? c.design).wall;
              const inside = b ? `shaft ${mm(b.x1 - b.x0 - 2 * wall)} × ${mm(b.y1 - b.y0 - 2 * wall)}` : "";
              return boxItem("cores", c, `at ${gridRef(c)} · ${inside}`);
            })}
          </div>
        </section>
      )}

      <section className={s.group}>
        <h3 className={s.groupTitle}>
          Openings <small>voids, stairs{floor.openings.some((o) => o.kind === "pool") ? ", pool" : ""}</small>
        </h3>
        <div className={s.items}>
          {floor.openings.map((o) =>
            boxItem(
              "openings",
              o,
              `${KIND_LABEL[o.kind].toLowerCase()} ${sizeText(floor, o)}${o.added ? " · added on site" : ""}`,
            ),
          )}
          {!floor.openings.length && <div className={s.empty}>No openings on this floor yet.</div>}
        </div>
        <div className={s.row} style={{ marginTop: 10 }}>
          <button type="button" className={s.btn} onClick={onAddVoid}>
            + Add a void on the plan
          </button>
        </div>
      </section>

      {floor.slab && corners && (
        <section className={s.group}>
          <h3 className={s.groupTitle}>
            Slab edges <small>how far each edge is from its grid line</small>
          </h3>
          <div className={s.items}>
            {floor.slab.edges.map((edge, i) => {
              const [p, q] = edgeSegment(corners, i);
              const along: Axis = edge.axis === "x" ? "y" : "x";
              const span = `${nearest(floor, along, p[along === "x" ? 0 : 1])} to ${nearest(floor, along, q[along === "x" ? 0 : 1])}`;
              const dev = edgeDeviation(floor, edge);
              const on = selection?.kind === "edge" && selection.key === edge._key;
              return (
                <button
                  key={edge._key}
                  type="button"
                  className={on ? s.itemOn : s.item}
                  onClick={() => onSelect({ kind: "edge", key: edge._key })}
                >
                  <span>
                    <span className={s.itemName}>{offsetText(edge.axis, edge.actual ?? edge.design, edge.ref)}</span>
                    <span className={s.itemSub}> · runs {span}</span>
                    {edge.note && (
                      <span className={s.itemSub} style={{ color: "var(--brass-text)" }}>
                        {" "}
                        · check the drawing
                      </span>
                    )}
                  </span>
                  <StatusChip
                    status={dev === null ? "none" : statusFor(Math.abs(dev), tol)}
                    worst={dev === null ? null : Math.abs(dev)}
                  />
                </button>
              );
            })}
          </div>
        </section>
      )}

      {(["x", "y"] as const).map((axis) => (
        <section key={axis} className={s.group}>
          <h3 className={s.groupTitle}>
            Grid {axis === "x" ? "across" : "down"}{" "}
            <small>{axis === "x" ? "lettered lines, left to right" : "numbered lines, top to bottom"}</small>
          </h3>
          <div className={s.items}>
            {gapsOf(floor, axis).map((g) => {
              const on = selection?.kind === "gap" && selection.axis === axis && selection.to === g.to.id;
              const diff = Math.abs(g.actual - g.design);
              return (
                <button
                  key={g.to.id}
                  type="button"
                  className={on ? s.itemOn : s.item}
                  onClick={() => onSelect({ kind: "gap", axis, to: g.to.id })}
                >
                  <span>
                    <span className={s.itemName}>
                      {g.from.id} to {g.to.id}
                    </span>
                    <span className={s.itemSub}>
                      {" "}
                      · {mm(g.actual)}
                      {Math.round(g.actual) !== Math.round(g.design) ? ` (drawing ${mm(g.design)})` : ""}
                    </span>
                  </span>
                  <StatusChip status={g.measured ? statusFor(diff, tol) : "none"} worst={g.measured ? diff : null} />
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
