"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useToast } from "@/components/crm/Toasts";
import { saveAsBuiltAction } from "@/lib/actions/asbuilt";
import { gridRef, moveText } from "@/lib/asbuilt/format";
import { boxOf, centreOf, gridLines, linePos } from "@/lib/asbuilt/geometry";
import { applyChanges, pathOf } from "@/lib/asbuilt/paths";
import { floorBelow } from "@/lib/asbuilt/setout";
import {
  DEFAULT_TOLERANCE,
  type Change,
  type Floor,
  type LogEntry,
  type OpeningEl,
  type Selection,
  type Tolerance,
} from "@/lib/asbuilt/types";

import s from "./AsBuilt.module.css";
import { HistoryView, parseChanges } from "./HistoryView";
import { ListView } from "./ListView";
import { PlanView } from "./PlanView";
import { SetOutView } from "./SetOutView";
import { Sheet } from "./Sheet";
import { useLocalSetting } from "./useLocalSetting";

export type AsBuiltTab = "plan" | "list" | "setout" | "history";

const TABS: { key: AsBuiltTab; label: string }[] = [
  { key: "plan", label: "Plan" },
  { key: "list", label: "Measure" },
  { key: "setout", label: "Set out" },
  { key: "history", label: "History" },
];

interface Props {
  initialFloors: Floor[];
  initialKey: string;
  initialTab: AsBuiltTab;
  /** False on a preview or local copy: changes go to a separate test record. */
  realRecord: boolean;
}

interface Settings {
  tol: Tolerance;
  pullBack: number;
}

const DEFAULT_SETTINGS: Settings = { tol: DEFAULT_TOLERANCE, pullBack: 0 };
const VOID_SIZE = 1000;
const snap25 = (v: number) => Math.round(v / 25) * 25;

type SaveFn = (key: string, changes: Change[], text: string, el?: string, undoOf?: string) => Promise<boolean>;

/** The changes that put back what an entry changed. */
function reverseOf(entry: LogEntry): Change[] {
  return parseChanges(entry)
    .map((c) => ({ path: c.path, value: c.before }))
    .reverse();
}

function newVoidKey(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `v${Array.from(bytes, (b) => (b % 36).toString(36)).join("")}`;
}

export function AsBuiltApp({ initialFloors, initialKey, initialTab, realRecord }: Props) {
  const [floors, setFloors] = useState(initialFloors);
  const [floorKey, setFloorKey] = useState(initialKey);
  const [tab, setTab] = useState<AsBuiltTab>(initialTab);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [saving, setSaving] = useState(0);
  const [placing, setPlacing] = useState(false);
  const [full, setFull] = useState(false);
  const [settings, setSettings] = useLocalSetting<Settings>("lexington.asbuilt.settings", DEFAULT_SETTINGS);
  const toast = useToast();
  const floorRow = useRef<HTMLElement>(null);
  // Saves go one at a time, in order. What's on screen is the last floor the server
  // confirmed with any saves still on their way laid over it, so a slow answer can
  // never undo a newer change on screen.
  const confirmed = useRef<Map<string, Floor> | null>(null);
  const pending = useRef<{ id: number; key: string; changes: Change[] }[]>([]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const nextId = useRef(1);

  const floor = floors.find((f) => f.key === floorKey) ?? floors[0];
  const below = floor ? floorBelow(floors, floor) : null;

  useEffect(() => {
    floorRow.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [floorKey]);

  // Full-screen plan: the page behind doesn't scroll, and Esc leaves it.
  useEffect(() => {
    if (!full) return;
    const html = document.documentElement;
    const before = html.style.overflow;
    html.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      html.style.overflow = before;
      window.removeEventListener("keydown", onKey);
    };
  }, [full]);

  // Keep the address in step, so a refresh (or a saved link) opens the same floor and tab.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("floor", floorKey);
    url.searchParams.set("view", tab);
    window.history.replaceState(null, "", url.toString());
  }, [floorKey, tab]);

  const saveRef = useRef<SaveFn | null>(null);

  const save = useCallback<SaveFn>(
    (key, changes, text, el, undoOf) => {
      if (!confirmed.current) confirmed.current = new Map(initialFloors.map((f) => [f.key, f]));
      const known = confirmed.current;
      const redraw = () => {
        const base = known.get(key);
        if (!base) return;
        const shown = pending.current
          .filter((p) => p.key === key)
          .reduce((acc, p) => applyChanges(acc, p.changes), base);
        setFloors((all) => all.map((f) => (f.key === key ? shown : f)));
      };
      const id = nextId.current++;
      const settle = () => {
        pending.current = pending.current.filter((p) => p.id !== id);
      };
      // Show it at once.
      pending.current.push({ id, key, changes });
      redraw();
      setSaving((n) => n + 1);

      const run = async (): Promise<boolean> => {
        try {
          const res = await saveAsBuiltAction({ floor: key, changes, text, el, undoOf });
          settle();
          if (!res.ok) {
            redraw();
            toast.show(res.error);
            return false;
          }
          known.set(key, res.floor);
          redraw();
          const entry = undoOf
            ? null
            : [...(res.floor.log ?? [])].reverse().find((l) => l.text === text.trim().slice(0, 300));
          toast.show(
            undoOf ? text : `Saved: ${text}`,
            entry
              ? () => void saveRef.current?.(key, reverseOf(entry), `Undid: ${entry.text}`, entry.el, entry._key)
              : undefined,
          );
          return true;
        } catch {
          settle();
          redraw();
          toast.show("Couldn't save. Check the connection and try again.");
          return false;
        } finally {
          setSaving((n) => n - 1);
        }
      };
      const done = queue.current.then(run, run);
      queue.current = done;
      return done;
    },
    [toast, initialFloors],
  );

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const undoEntry = useCallback(
    (key: string, entry: LogEntry) => save(key, reverseOf(entry), `Undid: ${entry.text}`, entry.el, entry._key),
    [save],
  );

  const saveHere = useCallback(
    (changes: Change[], text: string, el?: string) => save(floorKey, changes, text, el),
    [save, floorKey],
  );

  const chooseFloor = (key: string) => {
    setFloorKey(key);
    setSelection(null);
    setPlacing(false);
  };

  const chooseTab = (key: AsBuiltTab) => {
    setTab(key);
    if (key !== "plan") setFull(false);
    if (key !== "plan") setPlacing(false);
  };

  // A void made on site: drop a 1 m square where the plan was tapped, then let the numbers be put right.
  const placeVoid = async (x: number, y: number) => {
    if (!floor) return;
    setPlacing(false);
    const nearest = (axis: "x" | "y", v: number) =>
      gridLines(floor, axis).reduce((best, l) =>
        Math.abs((linePos(floor, axis, l.id, "actual") ?? 0) - v) <
        Math.abs((linePos(floor, axis, best.id, "actual") ?? 0) - v)
          ? l
          : best,
      );
    const lx = nearest("x", x);
    const ly = nearest("y", y);
    const px = linePos(floor, "x", lx.id, "actual") ?? 0;
    const py = linePos(floor, "y", ly.id, "actual") ?? 0;
    const l = snap25(x - VOID_SIZE / 2 - px);
    const t = snap25(y - VOID_SIZE / 2 - py);
    const count = floor.openings.filter((o) => o.added).length + 1;
    const key = newVoidKey();
    const opening: OpeningEl = {
      _key: key,
      kind: "void",
      name: `Void ${count}`,
      x: lx.id,
      y: ly.id,
      design: null,
      actual: { l, r: l + VOID_SIZE, t, b: t + VOID_SIZE },
      added: true,
      at: new Date().toISOString(),
    };
    const ok = await save(
      floor.key,
      [{ path: pathOf("openings", key), value: opening }],
      `Added ${opening.name} by ${gridRef(opening)}`,
      key,
    );
    if (ok) setSelection({ kind: "box", list: "openings", key });
  };

  const moveOpening = async (key: string, dx: number, dy: number) => {
    if (!floor) return;
    const el = floor.openings.find((o) => o._key === key);
    const cur = el ? (el.actual ?? el.design) : null;
    if (!el || !cur) return;
    const faces = { l: cur.l + dx, r: cur.r + dx, t: cur.t + dy, b: cur.b + dy };
    const text = `${el.name}: moved ${moveText(dx, dy)}`;
    const now = new Date().toISOString();
    if (el.added) {
      // Made on site: hang it on the grid lines nearest to where it now is.
      const b = boxOf(floor, el, "actual");
      const nearest = (axis: "x" | "y", v: number) =>
        gridLines(floor, axis).reduce((best, l) =>
          Math.abs((linePos(floor, axis, l.id, "actual") ?? 0) - v) <
          Math.abs((linePos(floor, axis, best.id, "actual") ?? 0) - v)
            ? l
            : best,
        );
      if (b) {
        const [cx, cy] = centreOf(b);
        const lx = nearest("x", cx + dx);
        const ly = nearest("y", cy + dy);
        const px = linePos(floor, "x", lx.id, "actual") ?? 0;
        const py = linePos(floor, "y", ly.id, "actual") ?? 0;
        const ox = linePos(floor, "x", el.x, "actual") ?? 0;
        const oy = linePos(floor, "y", el.y, "actual") ?? 0;
        const moved = {
          ...el,
          x: lx.id,
          y: ly.id,
          actual: { l: faces.l + ox - px, r: faces.r + ox - px, t: faces.t + oy - py, b: faces.b + oy - py },
          at: now,
        };
        await save(floor.key, [{ path: pathOf("openings", key), value: moved }], text, key);
        return;
      }
    }
    await save(
      floor.key,
      [
        { path: pathOf("openings", key, "actual"), value: faces },
        { path: pathOf("openings", key, "at"), value: now },
      ],
      text,
      key,
    );
  };

  if (!floor) return <div className={s.empty}>No floors yet.</div>;

  const counts = (f: Floor) => {
    const all = [...f.columns, ...f.cores];
    return `${all.filter((e) => e.actual).length}/${all.length}`;
  };

  const panel = selection ? (
    <Sheet
      floor={floor}
      selection={selection}
      tol={settings.tol}
      busy={saving > 0}
      onClose={() => setSelection(null)}
      onSave={saveHere}
    />
  ) : null;

  return (
    <div className={full ? `${s.app} ${s.appFull}` : s.app}>
      {!realRecord && (
        <div className={s.devBanner}>
          Test copy: anything saved here is kept apart from the real record, so try things freely.
        </div>
      )}

      <div className={s.top}>
        <h1 className={s.title}>As-built record</h1>
        <span className={s.saving} aria-live="polite">
          {saving > 0 ? "Saving…" : ""}
        </span>
        <span className={s.downloads}>
          {/* File downloads from a route handler, not pages, so plain links. */}
          <a href="/admin/asbuilt/export?format=csv" download>
            Download all (Excel)
          </a>
          <a href="/admin/asbuilt/export?format=json" download>
            Backup file
          </a>
        </span>
      </div>

      <nav ref={floorRow} className={s.floors} aria-label="Floors">
        {[...floors]
          .sort((a, b) => b.order - a.order)
          .map((f) => (
            <button
              key={f.key}
              type="button"
              className={f.key === floor.key ? s.floorActive : s.floor}
              aria-pressed={f.key === floor.key}
              onClick={() => chooseFloor(f.key)}
            >
              <span className={s.floorName}>
                {f.key === "g" ? "Ground" : f.key === "roof" ? "Roof" : f.name.replace(" floor", "")}
              </span>
              <span className={s.floorCount}>{counts(f)}</span>
            </button>
          ))}
      </nav>

      <div className={s.tabs} role="tablist" aria-label="Views">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? s.tabActive : s.tab}
            onClick={() => chooseTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <details className={s.about}>
        <summary>
          {floor.name} · level +{floor.level} · where this comes from
          {floor.notes.length ? ` · ${floor.notes.length} drawing ${floor.notes.length === 1 ? "note" : "notes"}` : ""}
        </summary>
        <div className={s.aboutBody}>
          <p>{floor.source}</p>
          {floor.notes.length > 0 && (
            <ul className={s.noteList}>
              {floor.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      </details>

      <div className={panel ? s.workWithPanel : s.work}>
        <div>
          {tab === "plan" && (
            <PlanView
              floor={floor}
              below={below}
              tol={settings.tol}
              selection={selection}
              onSelect={setSelection}
              placing={placing}
              onPlace={placeVoid}
              onStartPlace={() => {
                setSelection(null);
                setPlacing(true);
              }}
              onCancelPlace={() => setPlacing(false)}
              full={full}
              onToggleFull={() => setFull((f) => !f)}
              onMoveOpening={(key, dx, dy) => void moveOpening(key, dx, dy)}
              floorNav={{
                up: [...floors].sort((a, b) => a.order - b.order).find((f) => f.order > floor.order) ?? null,
                down: [...floors].sort((a, b) => b.order - a.order).find((f) => f.order < floor.order) ?? null,
                go: chooseFloor,
              }}
            />
          )}
          {tab === "list" && (
            <ListView
              floor={floor}
              tol={settings.tol}
              busy={saving > 0}
              selection={selection}
              onSelect={setSelection}
              onSave={saveHere}
              onAddVoid={() => {
                setTab("plan");
                setSelection(null);
                setPlacing(true);
              }}
            />
          )}
          {tab === "setout" && (
            <SetOutView
              floors={floors}
              floor={floor}
              tol={settings.tol}
              pullBack={settings.pullBack}
              onTol={(tol) => setSettings({ ...settings, tol })}
              onPullBack={(pullBack) => setSettings({ ...settings, pullBack })}
              onSelect={setSelection}
            />
          )}
          {tab === "history" && (
            <HistoryView floor={floor} busy={saving > 0} onUndo={(entry) => void undoEntry(floor.key, entry)} />
          )}
        </div>
        {panel}
      </div>
    </div>
  );
}
