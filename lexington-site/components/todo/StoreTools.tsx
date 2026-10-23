"use client";

import { useEffect, useMemo, useState } from "react";

import {
  ghanaDay,
  MAX_MOVE_NOTE,
  MAX_PERSON,
  MAX_TOOL_COUNT,
  MAX_TOOL_NAME,
  stillOut,
  toolWord,
  UNDO_MINUTES,
  type StoreTool,
  type ToolOut,
  type ToolReturn,
} from "@/lib/store/shared";
import { photoAt, type TodoMe } from "@/lib/todo/shared";
import { errorText, send } from "./api";
import site from "./Site.module.css";
import { CameraIcon, dayLabel, EntryPhoto, ghanaTime, minutesSince, PhotoField, Stepper } from "./StoreBits";
import styles from "./Todo.module.css";
import { useUploadSlot } from "./useUploadSlot";

// Tools in the store room (Niko, 23 Oct 2026: "a section for tools with daily take outs and
// returns"): who has what right now, several tools taken out at once with one photo, and what came
// back, ticked off person by person at the end of the day. Anything not back by the next day is red.

/** Out now per tool, added up from the take-outs still open. */
export function outByTool(outs: ToolOut[]) {
  const map = new Map<string, number>();
  for (const o of outs) if (!o.closedAt) map.set(o.toolId, (map.get(o.toolId) ?? 0) + stillOut(o));
  return map;
}

/** Still out from an earlier day. */
export const isLate = (o: ToolOut) => !o.closedAt && stillOut(o) > 0 && ghanaDay(o.at) < ghanaDay();
const since = (iso: string) => {
  const label = dayLabel(ghanaDay(iso));
  return label === "Yesterday" ? "since yesterday" : `since ${label}`;
};
const named = (name: string, n: number) => (n > 1 ? `${name} ×${n}` : name);
const canUndoOut = (o: ToolOut, isAdmin: boolean) => o.returns.length === 0 && (isAdmin || (o.mine && minutesSince(o.at) < UNDO_MINUTES));
const canUndoReturn = (r: ToolReturn, isAdmin: boolean) => isAdmin || (r.mine && !r.lost && minutesSince(r.at) < UNDO_MINUTES);

type Armed = { armed: string | null; setArmed: (id: string | null) => void };

/** One take-out in a list: what, who, when, and what came back of it. */
function OutEntry({
  out,
  head,
  withDay,
  isAdmin,
  armed,
  setArmed,
  onOpenPhoto,
  onUndoOut,
  onUndoReturn,
}: {
  out: ToolOut;
  /** After the number: the tool and who took it (or, on the tool's own page, just who). */
  head: string;
  /** Say which day (a tool's own history goes back further than the day lists). */
  withDay?: boolean;
  isAdmin: boolean;
  onOpenPhoto: (url: string) => void;
  onUndoOut: (out: ToolOut) => void;
  onUndoReturn: (out: ToolOut, key: string) => void;
} & Armed) {
  const left = stillOut(out);
  const late = isLate(out);
  const lost = out.returns.filter((r) => r.lost).reduce((n, r) => n + r.qty, 0);
  const back = out.qty - left - lost;
  const status =
    [back && (left || lost) ? `${back} back` : "", lost ? (back || left ? `${lost} lost` : "Lost") : "", left ? (back || lost ? `${left} still out` : "Still out") : ""]
      .filter(Boolean)
      .join(", ") || "All back";
  return (
    <article className={site.entry}>
      <div className={site.entryText}>
        <p className={site.entryHead}>
          <span className={site.minus}>−{out.qty}</span> {head}
        </p>
        <p className={`${site.entrySub} ${lost || late ? site.entryBad : left === 0 ? site.entryGood : site.entryOdd}`}>
          {status}
          {late ? ` (out ${since(out.at)})` : ""}
        </p>
        {out.note && <p className={site.entrySub}>&ldquo;{out.note}&rdquo;</p>}
        <p className={site.entryWho}>
          Out {withDay ? `${dayLabel(ghanaDay(out.at))} ` : ""}
          {ghanaTime(out.at)} · recorded by {out.by}
        </p>
        {out.returns.map((r) => (
          <div key={r.key} className={site.returnLine}>
            <p className={r.lost ? site.entryBad : site.entryWho}>
              {r.lost ? `Lost: ${r.qty}` : `Back ${r.qty}`} · {ghanaDay(r.at) === ghanaDay(out.at) ? ghanaTime(r.at) : `${dayLabel(ghanaDay(r.at))} ${ghanaTime(r.at)}`} ·{" "}
              {r.lost ? "marked by" : "by"} {r.by}
              {r.note ? ` · “${r.note}”` : ""}
            </p>
            <EntryPhoto url={r.photoUrl} onOpen={onOpenPhoto} />
            {canUndoReturn(r, isAdmin) && (
              <button
                type="button"
                className={armed === r.key ? styles.dangerArmed : site.entryUndo}
                onClick={() => (armed === r.key ? onUndoReturn(out, r.key) : setArmed(r.key))}
              >
                {armed === r.key ? "Tap again" : isAdmin ? "Remove" : "Undo"}
              </button>
            )}
          </div>
        ))}
      </div>
      <EntryPhoto url={out.photoUrl} onOpen={onOpenPhoto} />
      {canUndoOut(out, isAdmin) && (
        <button type="button" className={armed === out.id ? styles.dangerArmed : site.entryUndo} onClick={() => (armed === out.id ? onUndoOut(out) : setArmed(out.id))}>
          {armed === out.id ? "Tap again" : isAdmin ? "Remove" : "Undo"}
        </button>
      )}
    </article>
  );
}

/* ---------- the Tools tab ---------- */

export function ToolsTab({
  me,
  tools,
  outs,
  onOpenTool,
  onTakeOut,
  onReturn,
  onNewTool,
  onOpenPhoto,
  onUndoOut,
  onUndoReturn,
}: {
  me: TodoMe;
  tools: StoreTool[];
  outs: ToolOut[];
  onOpenTool: (id: string) => void;
  onTakeOut: (toolId?: string) => void;
  onReturn: (outIds: string[]) => void;
  onNewTool: () => void;
  onOpenPhoto: (url: string) => void;
  onUndoOut: (out: ToolOut) => void;
  onUndoReturn: (out: ToolOut, key: string) => void;
}) {
  const isAdmin = me.kind === "admin";
  const [find, setFind] = useState("");
  const [showRetired, setShowRetired] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const byId = useMemo(() => new Map(tools.map((t) => [t.id, t])), [tools]);
  const out = useMemo(() => outByTool(outs), [outs]);
  const name = (id: string) => byId.get(id)?.name ?? "A tool no longer on the list";

  // Who has what now, people with something out since an earlier day first.
  const people = useMemo(() => {
    const groups = new Map<string, { person: string; lines: ToolOut[] }>();
    for (const o of [...outs].reverse()) {
      if (o.closedAt || stillOut(o) === 0) continue;
      const k = o.person.trim().toLowerCase();
      const g = groups.get(k) ?? { person: o.person, lines: [] };
      g.lines.push(o);
      groups.set(k, g);
    }
    return [...groups.values()]
      .map((g) => ({ ...g, late: g.lines.some(isLate) }))
      .sort((a, b) => Number(b.late) - Number(a.late) || a.lines[0].at.localeCompare(b.lines[0].at));
  }, [outs]);
  const outCount = useMemo(() => [...out.values()].reduce((a, b) => a + b, 0), [out]);
  const holders = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const g of people) for (const o of g.lines) map.set(o.toolId, [...new Set([...(map.get(o.toolId) ?? []), g.person])]);
    return map;
  }, [people]);

  const active = tools.filter((t) => !t.retired);
  const retired = tools.filter((t) => t.retired);
  const q = find.trim().toLowerCase();
  const shown = active.filter((t) => !q || t.name.toLowerCase().includes(q));
  const days = useMemo(() => {
    const groups: { day: string; outs: ToolOut[] }[] = [];
    for (const o of outs) {
      const day = ghanaDay(o.at);
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.outs.push(o);
      else groups.push({ day, outs: [o] });
    }
    return groups;
  }, [outs]);

  const toolRow = (t: StoreTool) => {
    const o = out.get(t.id) ?? 0;
    const inStore = t.count - o;
    const who = holders.get(t.id) ?? [];
    const status =
      o === 0
        ? t.count === 0
          ? "None at the moment"
          : `All ${t.count} in the store`
        : inStore < 0
          ? `${o} out: more than we have, check the number`
          : `${o} out: ${who.slice(0, 3).join(", ")}${who.length > 3 ? "…" : ""}`;
    return (
      <button key={t.id} type="button" className={site.itemRow} onClick={() => onOpenTool(t.id)}>
        {t.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a resized copy from the image store
          <img className={site.itemThumb} src={photoAt(t.photoUrl, 120)} alt="" loading="lazy" />
        ) : (
          <span className={site.itemThumbEmpty} aria-hidden="true">
            <CameraIcon />
          </span>
        )}
        <span className={site.itemName}>
          {t.name}
          <small className={inStore < 0 ? site.flagBad : o > 0 ? site.flagLow : undefined}>{status}</small>
        </span>
        <span className={inStore < 0 ? site.levelBad : inStore === 0 && t.count > 0 ? site.levelLow : site.level}>
          {inStore} <small>of {t.count}</small>
        </span>
      </button>
    );
  };

  return (
    <>
      <div className={site.toolBar}>
        <button type="button" className={site.bigAction} onClick={() => onTakeOut()} disabled={active.length === 0}>
          Take out tools
        </button>
        <button type="button" className={site.newButton} onClick={onNewTool}>
          + New tool
        </button>
      </div>

      {tools.length === 0 && (
        <p className={styles.empty}>No tools on the list yet. Tap + New tool for each kind of tool in the store, with a photo and how many there are.</p>
      )}

      {people.length > 0 && (
        <section className={styles.group}>
          <h2 className={styles.groupTitle}>
            Out now <span>{outCount}</span>
          </h2>
          {people.map((p) => (
            <article key={p.person} className={`${site.outCard} ${p.late ? site.outCardLate : ""}`} aria-label={`Out with ${p.person}`}>
              <div className={site.outHead}>
                <p className={site.outPerson}>{p.person}</p>
                <button type="button" className={site.outBack} onClick={() => onReturn(p.lines.map((o) => o.id))}>
                  {p.lines.length > 1 ? "All back" : "Back"}
                </button>
              </div>
              {p.lines.map((o) => (
                <div key={o.id} className={site.outLine}>
                  <button type="button" className={site.outTool} onClick={() => onOpenTool(o.toolId)}>
                    {named(name(o.toolId), stillOut(o))}
                  </button>
                  <span className={isLate(o) ? site.outLate : site.outWhen}>{isLate(o) ? `Not back: out ${since(o.at)}` : `out ${ghanaTime(o.at)}`}</span>
                  {p.lines.length > 1 && (
                    <button type="button" className={site.outLineBack} onClick={() => onReturn([o.id])}>
                      Back
                    </button>
                  )}
                </div>
              ))}
            </article>
          ))}
        </section>
      )}

      {tools.length > 0 && (
        <section className={styles.group}>
          <h2 className={styles.groupTitle}>
            Tools <span>{active.length}</span>
          </h2>
          {active.length > 8 && (
            <input
              className={styles.input}
              type="search"
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="Find a tool…"
              aria-label="Find a tool"
              enterKeyHint="search"
            />
          )}
          {shown.length > 0 ? <div className={site.itemList}>{shown.map(toolRow)}</div> : active.length > 0 && <p className={styles.empty}>Nothing matches.</p>}
          {isAdmin && retired.length > 0 && (
            <>
              <button type="button" className={styles.linkButton} onClick={() => setShowRetired(!showRetired)}>
                {showRetired ? "Hide" : "Show"} {retired.length} not used any more
              </button>
              {showRetired && <div className={site.itemList}>{retired.map(toolRow)}</div>}
            </>
          )}
        </section>
      )}

      {days.map((d) => (
        <section key={d.day} className={styles.group}>
          <h2 className={styles.groupTitle}>
            {dayLabel(d.day)}: tools out <span>{d.outs.length}</span>
          </h2>
          {d.outs.map((o) => (
            <OutEntry
              key={o.id}
              out={o}
              head={`${name(o.toolId)} · ${o.person}`}
              isAdmin={isAdmin}
              armed={armed}
              setArmed={setArmed}
              onOpenPhoto={onOpenPhoto}
              onUndoOut={onUndoOut}
              onUndoReturn={onUndoReturn}
            />
          ))}
        </section>
      ))}
    </>
  );
}

/* ---------- one tool ---------- */

export function ToolSheet({
  tool,
  me,
  outs,
  onClose,
  onTakeOut,
  onReturn,
  onEdit,
  onPhoto,
  onLost,
  onOpenPhoto,
  onUndoOut,
  onUndoReturn,
}: {
  tool: StoreTool;
  me: TodoMe;
  /** All the take-outs the page has (this tool's are picked out). */
  outs: ToolOut[];
  onClose: () => void;
  onTakeOut: () => void;
  onReturn: (outIds: string[]) => void;
  onEdit: () => void;
  onPhoto: (tool: StoreTool) => void;
  onLost: (out: ToolOut) => void;
  onOpenPhoto: (url: string) => void;
  onUndoOut: (out: ToolOut) => void;
  onUndoReturn: (out: ToolOut, key: string) => void;
}) {
  const isAdmin = me.kind === "admin";
  const [older, setOlder] = useState<ToolOut[] | null>(null);
  const [error, setError] = useState("");
  const [armed, setArmed] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const mine = useMemo(() => outs.filter((o) => o.toolId === tool.id), [outs, tool.id]);
  const open = mine.filter((o) => !o.closedAt && stillOut(o) > 0);
  const outNow = open.reduce((n, o) => n + stillOut(o), 0);
  const inStore = tool.count - outNow;
  // The page's own (fresh) take-outs over the whole history, which is asked for again when one
  // is added or taken off the record.
  const entries = useMemo(() => {
    const all = new Map((older ?? []).map((o) => [o.id, o]));
    for (const o of mine) all.set(o.id, o);
    return [...all.values()].sort((a, b) => b.at.localeCompare(a.at));
  }, [older, mine]);
  const ids = mine.map((o) => o.id).join();

  useEffect(() => {
    let live = true;
    fetch(`/api/store/tools/${tool.id}`, { cache: "no-store" })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || "Couldn't load everything for this tool. Check your signal.");
        if (live) setOlder(data.outs as ToolOut[]);
      })
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [tool.id, ids]);

  const { start, settled, clear } = useUploadSlot("/api/store/photo");
  const pickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPhotoBusy(true);
    setError("");
    start(file);
    try {
      const stored = await settled();
      if (!stored) throw new Error("The photo didn't upload. Try again.");
      const { tool: saved } = await send<{ tool: StoreTool }>(`/api/store/tools/${tool.id}`, "PATCH", { photoId: stored.id });
      clear(true);
      onPhoto(saved);
    } catch (err) {
      clear();
      setError(errorText(err));
    } finally {
      setPhotoBusy(false);
    }
  };

  return (
    <div className={styles.sheetBackdrop} onClick={onClose}>
      <div className={`${styles.sheet} ${site.sheetTall}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={tool.name}>
        <div className={site.itemHead}>
          <h2 className={styles.sheetTitle}>{tool.name}</h2>
          {isAdmin && (
            <button type="button" className={styles.linkButton} onClick={onEdit}>
              Change
            </button>
          )}
        </div>
        <div className={site.itemPhotoRow}>
          {tool.photoUrl ? (
            <button type="button" className={site.itemPhoto} onClick={() => onOpenPhoto(tool.photoUrl!)} aria-label="Open the photo">
              {/* eslint-disable-next-line @next/next/no-img-element -- a resized copy from the image store */}
              <img src={photoAt(tool.photoUrl, 240)} alt="" />
            </button>
          ) : (
            <label htmlFor="tool-camera" className={site.itemPhotoAdd} role="button" tabIndex={0}>
              <CameraIcon />
              {photoBusy ? "Saving…" : "Add photo"}
            </label>
          )}
          <div>
            <p className={inStore < 0 ? site.bigLevelBad : site.bigLevel}>
              {inStore} <small>in the store</small>
            </p>
            <p className={styles.sheetNote}>
              {tool.count} in all · {outNow} out{tool.retired ? " · not used any more" : ""}
            </p>
            {tool.photoUrl && (
              <label htmlFor="tool-camera" className={styles.linkButton} role="button" tabIndex={0}>
                {photoBusy ? "Saving the photo…" : "New photo"}
              </label>
            )}
          </div>
        </div>
        <input id="tool-camera" data-picker="tool-camera" className={styles.hiddenInput} type="file" accept="image/*" capture="environment" onChange={(e) => void pickPhoto(e)} />
        {inStore < 0 && <p className={site.gapBad}>More out than we have: something came back without being recorded, or the number is wrong.</p>}

        <button type="button" className={site.bigAction} onClick={onTakeOut} disabled={tool.retired}>
          Take out
        </button>

        {open.length > 0 && (
          <>
            <p className={styles.label}>Who has it now</p>
            <div className={site.sheetEntries}>
              {open.map((o) => (
                <div key={o.id} className={`${site.outLine} ${site.outLineSheet}`}>
                  <span className={site.outTool}>{named(o.person, stillOut(o))}</span>
                  <span className={isLate(o) ? site.outLate : site.outWhen}>{isLate(o) ? `out ${since(o.at)}` : `out ${ghanaTime(o.at)}`}</span>
                  <button type="button" className={site.outLineBack} onClick={() => onReturn([o.id])}>
                    Back
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      className={armed === `lost-${o.id}` ? styles.dangerArmed : site.entryUndo}
                      onClick={() => (armed === `lost-${o.id}` ? onLost(o) : setArmed(`lost-${o.id}`))}
                    >
                      {armed === `lost-${o.id}` ? "Tap again: lost" : "Lost"}
                    </button>
                  )}
                </div>
              ))}
            </div>
            {isAdmin && <p className={styles.sheetNote}>&ldquo;Lost&rdquo; is for a tool that won&rsquo;t come back: it comes off how many we have, with the name of who had it.</p>}
          </>
        )}

        <p className={styles.label}>Out and back</p>
        {error && <p className={styles.sheetError}>{error}</p>}
        {entries.length === 0 ? (
          <p className={styles.sheetNote}>{older === null && !error ? "Loading…" : "It hasn't been out yet."}</p>
        ) : (
          <div className={site.sheetEntries}>
            {entries.map((o) => (
              <OutEntry
                key={o.id}
                out={o}
                head={o.person}
                withDay
                isAdmin={isAdmin}
                armed={armed}
                setArmed={setArmed}
                onOpenPhoto={onOpenPhoto}
                onUndoOut={onUndoOut}
                onUndoReturn={onUndoReturn}
              />
            ))}
          </div>
        )}
        <button type="button" className={styles.sheetCancel} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/* ---------- taking tools out ---------- */

export function TakeOutSheet({
  tools,
  outs,
  people,
  first,
  onClose,
  onSaved,
  onSignedOut,
}: {
  tools: StoreTool[];
  outs: ToolOut[];
  /** Names used lately, offered as buttons. */
  people: string[];
  /** The tool it was opened from, already picked. */
  first?: string;
  onClose: () => void;
  onSaved: (outs: ToolOut[]) => void;
  onSignedOut: () => void;
}) {
  const [person, setPerson] = useState("");
  const [picked, setPicked] = useState<Record<string, number>>(() => (first ? { [first]: 1 } : {}));
  const [note, setNote] = useState("");
  const [find, setFind] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { slot, start, clear, settled } = useUploadSlot("/api/store/photo");
  const out = useMemo(() => outByTool(outs), [outs]);
  const q = find.trim().toLowerCase();
  // What's picked stays at the top; the rest in order, narrowed by the search.
  const list = [...tools.filter((t) => picked[t.id]), ...tools.filter((t) => !picked[t.id] && !t.retired && (!q || t.name.toLowerCase().includes(q)))];
  const total = Object.values(picked).reduce((a, b) => a + b, 0);
  const over = tools.filter((t) => picked[t.id] && picked[t.id] > t.count - (out.get(t.id) ?? 0));

  const pick = (id: string, n: number) =>
    setPicked((p) => {
      const next = { ...p };
      if (n > 0) next[id] = n;
      else delete next[id];
      return next;
    });

  const save = async () => {
    setError("");
    if (!slot) return setError("Take a photo of the tools going out first.");
    if (!person.trim()) return setError("Type who is taking them.");
    if (total === 0) return setError("Pick the tools going out.");
    setSaving(true);
    try {
      const photo = await settled();
      if (!photo) return setError("The photo didn't upload. Take it again.");
      const { outs: saved } = await send<{ outs: ToolOut[] }>("/api/store/tools/out", "POST", {
        person: person.trim(),
        note: note.trim(),
        photoId: photo.id,
        lines: Object.entries(picked).map(([toolId, qty]) => ({ toolId, qty })),
      });
      clear(true);
      onSaved(saved);
    } catch (e) {
      if ((e as { status?: number }).status === 401) onSignedOut();
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label="Take out tools">
        <h2 className={styles.sheetTitle}>Take out tools</h2>
        <PhotoField
          idBase="tool-out"
          slot={slot}
          onPick={start}
          onClear={() => clear()}
          required
          cameraOnly
          label="Photo of the tools going out"
          need="A photo of the tools going out is needed (all of them in one photo is fine)."
        />

        <label className={styles.label} htmlFor="tool-person">
          Who is taking them?
        </label>
        <input
          id="tool-person"
          className={styles.input}
          value={person}
          onChange={(e) => setPerson(e.target.value)}
          maxLength={MAX_PERSON}
          autoComplete="off"
          autoCapitalize="words"
          placeholder="e.g. Kofi (mason)"
        />
        {people.length > 0 && (
          <div className={styles.chips}>
            {people.map((p) => (
              <button key={p} type="button" className={person === p ? styles.chipOn : styles.chip} onClick={() => setPerson(person === p ? "" : p)}>
                {p}
              </button>
            ))}
          </div>
        )}

        <span className={styles.label}>Which tools?</span>
        {tools.length > 8 && (
          <input className={styles.input} type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a tool…" aria-label="Find a tool to take" />
        )}
        <div className={site.pickList}>
          {list.map((t) => {
            const inStore = t.count - (out.get(t.id) ?? 0);
            const n = picked[t.id];
            return (
              <div key={t.id} className={n ? site.pickRowOn : site.pickRow}>
                <span className={site.pickName}>
                  {t.name}
                  <small>{inStore <= 0 ? "None in the store by the record" : `${inStore} in the store`}</small>
                </span>
                {n ? (
                  <Stepper value={n} min={0} onChange={(v) => pick(t.id, v)} label={`How many: ${t.name}`} />
                ) : (
                  <button type="button" className={site.pickAdd} onClick={() => pick(t.id, 1)} aria-label={`Take ${t.name}`}>
                    Take
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {over.length > 0 && (
          <p className={site.gapOdd}>
            {over.map((t) => t.name).join(", ")}: more than the record says is in the store. Save it anyway if it&rsquo;s right (something may have come back without
            being recorded).
          </p>
        )}

        <label className={styles.label} htmlFor="tool-note">
          Note (optional)
        </label>
        <input
          id="tool-note"
          className={styles.input}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={MAX_MOVE_NOTE}
          autoComplete="off"
          placeholder="e.g. For the 5th floor formwork"
        />

        {error && <p className={styles.sheetError}>{error}</p>}
        <div className={styles.sheetButtons}>
          <button
            type="button"
            className={styles.sheetCancel}
            onClick={() => {
              clear();
              onClose();
            }}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.sheetSave}
            onClick={() => void save()}
            disabled={saving || slot?.state !== "ready" || total === 0 || !person.trim()}
          >
            {saving
              ? "Saving…"
              : !slot
                ? "Take the photo first"
                : slot.state === "uploading"
                  ? "Uploading the photo…"
                  : total === 0
                    ? "Pick the tools"
                    : !person.trim()
                      ? "Who is taking them?"
                      : `Take out ${total} ${toolWord(total)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- what came back ---------- */

export function ReturnSheet({
  lines,
  name,
  onClose,
  onSaved,
  onSignedOut,
}: {
  /** The take-outs it was opened for (one, or everything one person has). */
  lines: ToolOut[];
  name: (toolId: string) => string;
  onClose: () => void;
  onSaved: (outs: ToolOut[]) => void;
  onSignedOut: () => void;
}) {
  const [back, setBack] = useState<Record<string, number>>(() => Object.fromEntries(lines.map((o) => [o.id, stillOut(o)])));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { slot, start, clear, settled } = useUploadSlot("/api/store/photo");
  const people = [...new Set(lines.map((o) => o.person))];
  // Only what is still out now: someone else may have ticked one back meanwhile.
  const ticked = lines.filter((o) => (back[o.id] ?? 0) > 0).map((o) => ({ outId: o.id, qty: Math.min(back[o.id], stillOut(o)) }));
  const total = ticked.reduce((n, t) => n + t.qty, 0);

  const save = async () => {
    setError("");
    if (total === 0) return setError("Tick what came back.");
    setSaving(true);
    try {
      const photo = slot ? await settled() : null;
      if (slot && !photo) return setError("The photo didn't upload. Take it again, or remove it.");
      const { outs } = await send<{ outs: ToolOut[] }>("/api/store/tools/back", "POST", {
        returns: ticked,
        note: note.trim(),
        photoId: photo?.id ?? null,
      });
      clear(true);
      onSaved(outs);
    } catch (e) {
      if ((e as { status?: number }).status === 401) onSignedOut();
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label="Tools back">
        <h2 className={styles.sheetTitle}>{people.length === 1 ? `Back from ${people[0]}` : "Back to the store"}</h2>
        <p className={styles.sheetNote}>Untick anything that didn&rsquo;t come back.</p>
        <div className={site.pickList}>
          {lines.map((o) => {
            const left = stillOut(o);
            const n = back[o.id] ?? 0;
            return (
              <div key={o.id} className={n ? site.pickRowOn : site.pickRow}>
                <button
                  type="button"
                  className={site.pickTick}
                  aria-pressed={n > 0}
                  onClick={() => setBack((b) => ({ ...b, [o.id]: n > 0 ? 0 : left }))}
                  aria-label={`${n > 0 ? "Untick" : "Tick"} ${name(o.toolId)}`}
                >
                  {n > 0 ? "✓" : ""}
                </button>
                <span className={site.pickName}>
                  {name(o.toolId)}
                  <small>
                    {left} out{people.length > 1 ? ` with ${o.person}` : ""} · {isLate(o) ? since(o.at) : ghanaTime(o.at)}
                  </small>
                </span>
                {n > 0 && left > 1 && <Stepper value={n} max={left} onChange={(v) => setBack((b) => ({ ...b, [o.id]: v }))} label={`How many came back: ${name(o.toolId)}`} />}
              </div>
            );
          })}
        </div>
        <PhotoField idBase="tool-back" slot={slot} onPick={start} onClear={() => clear()} label="Photo (optional)" />
        <label className={styles.label} htmlFor="tool-back-note">
          Note (optional)
        </label>
        <input
          id="tool-back-note"
          className={styles.input}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={MAX_MOVE_NOTE}
          autoComplete="off"
          placeholder="e.g. Grinder disc broken"
        />
        {error && <p className={styles.sheetError}>{error}</p>}
        <div className={styles.sheetButtons}>
          <button
            type="button"
            className={styles.sheetCancel}
            onClick={() => {
              clear();
              onClose();
            }}
            disabled={saving}
          >
            Cancel
          </button>
          <button type="button" className={styles.sheetSave} onClick={() => void save()} disabled={saving || total === 0 || slot?.state === "uploading"}>
            {saving ? "Saving…" : slot?.state === "uploading" ? "Uploading the photo…" : total === 0 ? "Tick what came back" : `Back: ${total} ${toolWord(total)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- a tool for the list ---------- */

function CountField({ id, value, onChange, placeholder }: { id: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      id={id}
      className={`${styles.input} ${site.countInput}`}
      type="number"
      inputMode="numeric"
      min="0"
      max={MAX_TOOL_COUNT}
      step="1"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}
const wholeOk = (v: string) => v.trim() !== "" && Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= MAX_TOOL_COUNT;

export function NewToolSheet({ tools, onClose, onSaved }: { tools: StoreTool[]; onClose: () => void; onSaved: (tool: StoreTool) => void }) {
  const [name, setName] = useState("");
  const [count, setCount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { slot, start, clear, settled } = useUploadSlot("/api/store/photo");
  const clash = tools.find((t) => t.name.toLowerCase() === name.trim().replace(/\s+/g, " ").toLowerCase());

  const save = async () => {
    setError("");
    if (!name.trim()) return setError("Type what the tool is, e.g. Angle grinder.");
    if (!wholeOk(count)) return setError("Type how many we have (0 if none).");
    setSaving(true);
    try {
      const photo = slot ? await settled() : null;
      if (slot && !photo) return setError("The photo didn't upload. Take it again, or remove it.");
      const { tool } = await send<{ tool: StoreTool }>("/api/store/tools", "POST", { name: name.trim(), count: Number(count), photoId: photo?.id ?? null });
      clear(true);
      onSaved(tool);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label="New tool">
        <h2 className={styles.sheetTitle}>New tool</h2>
        <label className={styles.label} htmlFor="tool-new-name">
          What is it?
        </label>
        <input
          id="tool-new-name"
          className={styles.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_TOOL_NAME}
          autoComplete="off"
          autoCapitalize="sentences"
          placeholder="e.g. Angle grinder"
        />
        {clash && <p className={site.gapOdd}>&ldquo;{clash.name}&rdquo; is already on the tool list.</p>}
        <PhotoField idBase="tool-new" slot={slot} onPick={start} onClear={() => clear()} label="Photo of the tool (optional)" />
        <label className={styles.label} htmlFor="tool-new-count">
          How many do we have?
        </label>
        <CountField id="tool-new-count" value={count} onChange={setCount} placeholder="e.g. 4" />
        {error && <p className={styles.sheetError}>{error}</p>}
        <div className={styles.sheetButtons}>
          <button
            type="button"
            className={styles.sheetCancel}
            onClick={() => {
              clear();
              onClose();
            }}
            disabled={saving}
          >
            Cancel
          </button>
          <button type="button" className={styles.sheetSave} onClick={() => void save()} disabled={saving || !!clash}>
            {saving ? "Saving…" : "Add to the tools"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The office: rename, how many we have, not used any more. */
export function EditToolSheet({ tool, outNow, onClose, onSaved }: { tool: StoreTool; outNow: number; onClose: () => void; onSaved: (tool: StoreTool) => void }) {
  const [name, setName] = useState(tool.name);
  const [count, setCount] = useState(String(tool.count));
  const [retired, setRetired] = useState(tool.retired);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setError("");
    if (!wholeOk(count)) return setError("Type how many we have (0 if none).");
    setSaving(true);
    try {
      const { tool: saved } = await send<{ tool: StoreTool }>(`/api/store/tools/${tool.id}`, "PATCH", { name: name.trim(), count: Number(count), retired });
      onSaved(saved);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label={`Change ${tool.name}`}>
        <h2 className={styles.sheetTitle}>Change {tool.name}</h2>
        <label className={styles.label} htmlFor="tool-edit-name">
          Name
        </label>
        <input id="tool-edit-name" className={styles.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={MAX_TOOL_NAME} autoComplete="off" />
        <label className={styles.label} htmlFor="tool-edit-count">
          How many do we have?
        </label>
        <CountField id="tool-edit-count" value={count} onChange={setCount} />
        <p className={styles.sheetNote}>
          {outNow > 0 ? `${outNow} out now (counted in this number). ` : ""}Bought more, or found one: change it here. One that won&rsquo;t come back: mark it lost
          where it shows who has it.
        </p>
        <button type="button" className={retired ? styles.chipOn : styles.chip} aria-pressed={retired} onClick={() => setRetired(!retired)}>
          {retired ? "Not used any more ✓" : "In use"}
        </button>
        {error && <p className={styles.sheetError}>{error}</p>}
        <div className={styles.sheetButtons}>
          <button type="button" className={styles.sheetCancel} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className={styles.sheetSave} onClick={() => void save()} disabled={saving || !name.trim()}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
