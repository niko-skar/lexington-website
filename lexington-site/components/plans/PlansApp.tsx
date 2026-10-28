"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Floor } from "@/lib/asbuilt/types";
import { deletePlanAction, savePlanAction } from "@/lib/actions/plans";
import { addLabel, cloneWithNewKeys, EMPTY_PLAN, newKey, portPlan, removeLabel, removeOpening, removeWall } from "@/lib/plans/edit";
import { analysePlan, type P } from "@/lib/plans/geometry";
import type { OpeningKind, PlanContent, PlanOption, PlanPoint, PlanReference, WallKind } from "@/lib/plans/types";

import { PlanCanvas, type Sel, type Tool } from "./PlanCanvas";
import { PlanPanel } from "./PlanPanel";
import s from "./Plans.module.css";

export interface WebsiteUnit {
  unit: string;
  floor: number;
  areaSqm: number;
}

interface Props {
  floors: Floor[];
  plans: PlanOption[];
  units: WebsiteUnit[];
  /** Architects' plans to trace over. */
  references: PlanReference[];
  realRecord: boolean;
  initialFloor: string;
  initialOption: string;
}

/** Soft fills, one per home, in turn. */
const COLOURS = ["#e7d7b9", "#cfdcc4", "#d6cfe2", "#f0cdbd", "#c9dbe3", "#e6dfa8", "#d9c4cc", "#c6d6cf", "#ecd3a8", "#d3d9e8"];

const contentOf = (p: PlanOption | null | undefined, fallbackName = "A"): PlanContent =>
  p
    ? { name: p.name, walls: p.walls ?? [], openings: p.openings ?? [], labels: p.labels ?? [], targets: p.targets ?? [] }
    : { ...EMPTY_PLAN, name: fallbackName };

/** The website's floor number for an as-built floor ("g" is 0; the roof holds the penthouses' upper floors). */
const websiteFloor = (key: string) => (key === "g" ? 0 : key === "roof" ? 7 : Number(key));

function nextOptionKey(taken: string[]): string {
  for (const c of "abcdefghijklmnopqrstuvwxyz") if (!taken.includes(c)) return c;
  return `o${Date.now().toString(36).slice(-5)}`;
}

type SaveState = { state: "saved" | "dirty" | "saving" | "error"; message?: string };

export function PlansApp({ floors, plans: initialPlans, units, references, realRecord, initialFloor, initialOption }: Props) {
  const [plans, setPlans] = useState(initialPlans);
  const [floorKey, setFloorKey] = useState(initialFloor);
  const optionsOf = useCallback((fk: string) => plans.filter((p) => p.floorKey === fk).sort((a, b) => a.option.localeCompare(b.option)), [plans]);
  const [optionKey, setOptionKey] = useState(initialOption || optionsOf(initialFloor)[0]?.option || "a");
  const saved = plans.find((p) => p.floorKey === floorKey && p.option === optionKey) ?? null;
  const floor = floors.find((f) => f.key === floorKey) ?? floors[0];

  const [draft, setDraft] = useState<PlanContent>(() => contentOf(saved));
  const [past, setPast] = useState<PlanContent[]>([]);
  const [future, setFuture] = useState<PlanContent[]>([]);
  const [preview, setPreview] = useState<PlanContent | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [wall, setWall] = useState<{ kind: WallKind; t: number }>({ kind: "partition", t: 125 });
  const [opening, setOpening] = useState<{ kind: OpeningKind; w: number }>({ kind: "door", w: 900 });
  const [selection, setSelection] = useState<Sel>(null);
  const [save, setSave] = useState<SaveState>({ state: "saved" });
  const [newer, setNewer] = useState<PlanOption | null>(null);
  const [focus, setFocus] = useState<{ at: P; n: number } | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  // The architect's plan underneath: how strongly it shows (0 = hidden).
  const [refShade, setRefShade] = useState(0.35);
  const reference = references.find((r) => r.floorKey === floorKey) ?? null;

  const shown = preview ?? draft;
  const analysis = useMemo(() => analysePlan(floor, shown), [floor, shown]);
  const websiteAreas = useMemo(
    () => new Map(units.filter((u) => u.floor === websiteFloor(floorKey)).map((u) => [u.unit.toUpperCase(), u.areaSqm] as const)),
    [units, floorKey],
  );
  const colourMap = useRef(new Map<string, string>());
  const colourOf = useCallback((unit: string) => {
    const m = colourMap.current;
    if (!m.has(unit)) m.set(unit, COLOURS[m.size % COLOURS.length]);
    return m.get(unit)!;
  }, []);

  // ---- saving: a moment after each change, and before leaving this layout -------------------------
  // One save at a time, each from the version the last one left (a save never overtakes another).
  const pending = useRef<{ floorKey: string; option: string; content: PlanContent } | null>(null);
  const revs = useRef(new Map<string, string | null>(initialPlans.map((p) => [`${p.floorKey}:${p.option}`, p._rev ?? null])));
  const inFlight = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The save, for the try-again timer (which can't name the function it is inside).
  const retry = useRef<() => void>(() => {});
  const flush = useCallback(async (force = false): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    while (inFlight.current) await inFlight.current;
    const job = pending.current;
    if (!job) return true;
    pending.current = null;
    const id = `${job.floorKey}:${job.option}`;
    const run = (async () => {
      setSave({ state: "saving" });
      const res = await savePlanAction({ floorKey: job.floorKey, option: job.option, rev: revs.current.get(id) ?? null, force, content: job.content });
      if (res.ok) {
        revs.current.set(id, res.plan._rev ?? null);
        setPlans((all) => [...all.filter((p) => p._id !== res.plan._id), res.plan]);
        setSave(pending.current ? { state: "dirty" } : { state: "saved" });
        return true;
      }
      pending.current = pending.current ?? job;
      if (res.newer) {
        setNewer(res.newer);
        setSave({ state: "error", message: res.error });
        return false;
      }
      setSave({ state: "error", message: res.error });
      timer.current = setTimeout(() => retry.current(), 10_000);
      return false;
    })();
    inFlight.current = run;
    try {
      return await run;
    } finally {
      inFlight.current = null;
    }
  }, []);
  useEffect(() => {
    retry.current = () => void flush();
  }, [flush]);

  const schedule = useCallback(
    (content: PlanContent) => {
      pending.current = { floorKey, option: optionKey, content };
      setSave({ state: "dirty" });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 1200);
    },
    [floorKey, optionKey, flush],
  );

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pending.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const commit = useCallback(
    (next: PlanContent) => {
      setPast((p) => [...p.slice(-99), draft]);
      setFuture([]);
      setDraft(next);
      schedule(next);
    },
    [draft, schedule],
  );

  const undo = useCallback(() => {
    if (!past.length) return;
    const prev = past[past.length - 1];
    setPast(past.slice(0, -1));
    setFuture((f) => [draft, ...f].slice(0, 100));
    setDraft(prev);
    schedule(prev);
  }, [past, draft, schedule]);

  const redo = useCallback(() => {
    if (!future.length) return;
    const next = future[0];
    setFuture(future.slice(1));
    setPast((p) => [...p, draft].slice(-100));
    setDraft(next);
    schedule(next);
  }, [future, draft, schedule]);

  // ---- switching floor or layout -------------------------------------------------------------------
  const open = useCallback(
    async (fk: string, option: string, all: PlanOption[] = plans) => {
      await flush();
      const p = all.find((x) => x.floorKey === fk && x.option === option) ?? null;
      setFloorKey(fk);
      setOptionKey(option);
      setDraft(contentOf(p, option.toUpperCase()));
      setPast([]);
      setFuture([]);
      setPreview(null);
      setSelection(null);
      setNewer(null);
      const url = new URL(window.location.href);
      url.searchParams.set("floor", fk);
      url.searchParams.set("option", option);
      window.history.replaceState(null, "", url.toString());
    },
    [flush, plans],
  );

  const addOption = async (copy: boolean) => {
    await flush();
    const key = nextOptionKey(optionsOf(floorKey).map((p) => p.option));
    const content: PlanContent = copy ? { ...cloneWithNewKeys(draft), name: `${key.toUpperCase()} (from ${draft.name})` } : { ...EMPTY_PLAN, name: key.toUpperCase() };
    setSave({ state: "saving" });
    const res = await savePlanAction({ floorKey, option: key, content });
    if (!res.ok) return setSave({ state: "error", message: res.error });
    revs.current.set(`${floorKey}:${key}`, res.plan._rev ?? null);
    const all = [...plans, res.plan];
    setPlans(all);
    setSave({ state: "saved" });
    await open(floorKey, key, all);
  };

  const renameOption = (name: string) => {
    const clean = name.trim().slice(0, 40);
    if (clean && clean !== draft.name) commit({ ...draft, name: clean });
  };

  const deleteOption = async () => {
    if (!saved) return;
    if (!window.confirm(`Delete the layout "${draft.name}" of this floor? A copy is kept, so it can be got back.`)) return;
    pending.current = null;
    const res = await deletePlanAction(floorKey, optionKey);
    if (!res.ok) return setSave({ state: "error", message: res.error });
    const all = plans.filter((p) => p._id !== saved._id);
    setPlans(all);
    await open(floorKey, all.filter((p) => p.floorKey === floorKey)[0]?.option ?? "a", all);
  };

  const copyToFloors = async (targets: string[]) => {
    await flush();
    setCopyOpen(false);
    setSave({ state: "saving" });
    let all = plans;
    for (const fk of targets) {
      const to = floors.find((f) => f.key === fk);
      if (!to) continue;
      const key = nextOptionKey(all.filter((p) => p.floorKey === fk).map((p) => p.option));
      const content = { ...cloneWithNewKeys(portPlan(draft, floor, to)), name: `${draft.name} (from ${floor.name})` };
      const res = await savePlanAction({ floorKey: fk, option: key, content });
      if (!res.ok) return setSave({ state: "error", message: `${to.name}: ${res.error}` });
      revs.current.set(`${fk}:${key}`, res.plan._rev ?? null);
      all = [...all, res.plan];
    }
    setPlans(all);
    setSave({ state: "saved", message: `Copied to ${targets.length} floor${targets.length === 1 ? "" : "s"}` });
  };

  const labelAt = (at: PlanPoint) => {
    const label = { _key: newKey("l"), at, name: "Room", type: "living" as const, unit: null };
    commit(addLabel(draft, label));
    setSelection({ kind: "label", key: label._key });
  };

  // ---- keys ---------------------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if ((e.key === "Delete" || (e.key === "Backspace" && tool === "select")) && selection) {
        e.preventDefault();
        if (selection.kind === "wall") commit(removeWall(draft, selection.key));
        else if (selection.kind === "opening") commit(removeOpening(draft, selection.key));
        else if (selection.kind === "label") commit(removeLabel(draft, selection.key));
        setSelection(null);
      } else if (!mod && tool !== "wall") {
        const k = e.key.toLowerCase();
        const map: Record<string, Tool> = { v: "select", w: "wall", d: "door", n: "window", r: "label" };
        if (map[k]) setTool(map[k]);
        if (e.key === "Escape") setSelection(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, selection, draft, commit, tool]);

  const options = optionsOf(floorKey);
  const otherFloors = floors.filter((f) => f.key !== floorKey);

  return (
    <div className={s.app}>
      {!realRecord && <div className={s.devBanner}>Test copy: plans saved here are kept apart from the real ones.</div>}
      <div className={s.top}>
        <h1 className={s.title}>Floor plans</h1>
        <div className={s.floors} role="tablist" aria-label="Floor">
          {[...floors].reverse().map((f) => (
            <button key={f.key} type="button" role="tab" aria-selected={f.key === floorKey} className={f.key === floorKey ? s.floorOn : s.floor} onClick={() => void open(f.key, optionsOf(f.key)[0]?.option ?? "a")}>
              {f.short}
              <small>{optionsOf(f.key).length ? `${optionsOf(f.key).length} layout${optionsOf(f.key).length === 1 ? "" : "s"}` : "–"}</small>
            </button>
          ))}
        </div>
      </div>

      <div className={s.bar}>
        <div className={s.options} role="tablist" aria-label="Layout">
          {(options.length ? options : [{ option: optionKey, name: draft.name } as PlanOption]).map((o) => (
            <button key={o.option} type="button" role="tab" aria-selected={o.option === optionKey} className={o.option === optionKey ? s.optionOn : s.option} onClick={() => o.option !== optionKey && void open(floorKey, o.option)}>
              {o.option === optionKey ? draft.name : o.name}
            </button>
          ))}
          <button type="button" className={s.option} onClick={() => void addOption(true)} title="A copy of this layout to try changes on">
            + Copy to try a change
          </button>
          <button type="button" className={s.option} onClick={() => void addOption(false)}>
            + Blank layout
          </button>
        </div>
        <div className={s.actions}>
          <button type="button" className={s.btn} onClick={undo} disabled={!past.length} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button type="button" className={s.btn} onClick={redo} disabled={!future.length} title="Redo (Ctrl+Y)">
            Redo
          </button>
          <details className={s.menu}>
            <summary className={s.btn}>Layout ▾</summary>
            <div className={s.menuBody}>
              <label className={s.field}>
                <span>Name</span>
                <input className={s.text} defaultValue={draft.name} key={`${floorKey}${optionKey}${draft.name}`} onBlur={(e) => renameOption(e.target.value)} />
              </label>
              <button type="button" className={s.btn} onClick={() => setCopyOpen(true)}>
                Copy to other floors…
              </button>
              <a className={s.btn} href={`/admin/plans/export?floor=${floorKey}&option=${optionKey}`}>
                Download areas (Excel)
              </a>
              <button type="button" className={s.danger} onClick={() => void deleteOption()} disabled={!saved}>
                Delete this layout
              </button>
            </div>
          </details>
          <span className={s[`save_${save.state}`]} role="status">
            {save.state === "saved" ? (save.message ?? "Saved") : save.state === "saving" ? "Saving…" : save.state === "dirty" ? "Not saved yet" : (save.message ?? "Not saved")}
          </span>
        </div>
      </div>

      {newer && (
        <div className={s.conflict} role="alert">
          This layout was changed on another screen.
          <button type="button" className={s.btn} onClick={() => {
            pending.current = null;
            revs.current.set(`${newer.floorKey}:${newer.option}`, newer._rev ?? null);
            setPlans((all) => [...all.filter((p) => p._id !== newer._id), newer]);
            setDraft(contentOf(newer));
            setNewer(null);
            setSave({ state: "saved" });
          }}>
            Use that one
          </button>
          <button type="button" className={s.btn} onClick={() => {
            setNewer(null);
            void flush(true);
          }}>
            Keep this one
          </button>
        </div>
      )}

      {copyOpen && (
        <CopyDialog
          floors={otherFloors}
          from={floor.name}
          onCancel={() => setCopyOpen(false)}
          onCopy={(keys) => void copyToFloors(keys)}
        />
      )}

      <div className={s.main}>
        <PlanCanvas
          floor={floor}
          plan={shown}
          analysis={analysis}
          tool={tool}
          wallKind={wall.kind}
          wallT={wall.t}
          openingKind={opening.kind}
          openingW={opening.w}
          selection={selection}
          onSelect={setSelection}
          onPreview={setPreview}
          onCommit={(p) => commit(p)}
          onLabelAt={labelAt}
          colourOf={colourOf}
          focus={focus}
          reference={reference}
          referenceShade={refShade}
        />
        <PlanPanel
          floor={floor}
          plan={draft}
          analysis={analysis}
          tool={tool}
          onTool={setTool}
          wallKind={wall.kind}
          wallT={wall.t}
          onWall={(kind, t) => setWall({ kind, t })}
          openingKind={opening.kind}
          openingW={opening.w}
          onOpening={(kind, w) => setOpening({ kind, w })}
          selection={selection}
          onSelect={setSelection}
          onCommit={(p) => commit(p)}
          websiteAreas={websiteAreas}
          reference={reference}
          referenceShade={refShade}
          onReferenceShade={setRefShade}
          printHref={(unit) => `/admin/plans/print?floor=${floorKey}&option=${optionKey}&unit=${encodeURIComponent(unit)}`}
          colourOf={colourOf}
          onFocus={(at) => setFocus((f) => ({ at, n: (f?.n ?? 0) + 1 }))}
        />
      </div>
    </div>
  );
}

function CopyDialog({ floors, from, onCancel, onCopy }: { floors: Floor[]; from: string; onCancel: () => void; onCopy: (keys: string[]) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  return (
    <div className={s.dialog} role="dialog" aria-modal="true" aria-label="Copy to other floors">
      <div className={s.dialogBody}>
        <h2 className={s.dialogTitle}>Copy this layout to other floors</h2>
        <p className={s.hint}>Each floor gets it as a new layout of its own (nothing there is written over), lined up on that floor&rsquo;s own as-built grid.</p>
        <div className={s.chips}>
          {floors.map((f) => (
            <button
              key={f.key}
              type="button"
              className={picked.includes(f.key) ? s.chipOn : s.chip}
              aria-pressed={picked.includes(f.key)}
              onClick={() => setPicked((p) => (p.includes(f.key) ? p.filter((k) => k !== f.key) : [...p, f.key]))}
            >
              {f.name}
            </button>
          ))}
        </div>
        <div className={s.dialogActions}>
          <button type="button" className={s.btn} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={s.btnPrimary} disabled={!picked.length} onClick={() => onCopy(picked)}>
            Copy from {from} to {picked.length || "…"} floor{picked.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}
