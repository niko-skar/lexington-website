"use client";

import { useState } from "react";

import {
  CONDITION_NAMES,
  ghanaDay,
  isOpenRepair,
  MAX_MOVE_NOTE,
  MAX_REPAIRER,
  UNDO_MINUTES,
  type StoreTool,
  type ToolRepair,
} from "@/lib/store/shared";
import { photoAt, type TodoMe } from "@/lib/todo/shared";
import { errorText, send } from "./api";
import site from "./Site.module.css";
import { CameraIcon, dayLabel, minutesSince, PhotoField, Stepper } from "./StoreBits";
import styles from "./Todo.module.css";
import { useUploadSlot } from "./useUploadSlot";

// Tools to fix (lib/store/shared.ts says what and why): the Tools tab's list of what's broken or needs repair, to send
// out and at the repairer, each with what it came back with; its sheet moves it on (sent, back fixed, or written off),
// and the list copies for WhatsApp, for whoever fixes them.

/** "today", "yesterday", "Monday 3 Nov". */
const onDay = (iso: string) => {
  const label = dayLabel(ghanaDay(iso));
  return label === "Today" || label === "Yesterday" ? label.toLowerCase() : label;
};
/** Whole days since, on site's calendar. */
const daysSince = (iso: string) => Math.max(0, Math.round((Date.parse(`${ghanaDay()}T00:00:00Z`) - Date.parse(`${ghanaDay(iso)}T00:00:00Z`)) / 86_400_000));
const named = (name: string, n: number) => (n > 1 ? `${name} ×${n}` : name);
const GONE_TOOL = "A tool no longer on the list";

/** The list for WhatsApp: what to send out to be fixed, then what's at the repairer. */
export function repairListText(repairs: readonly ToolRepair[], name: (toolId: string) => string): string {
  const open = repairs.filter(isOpenRepair).sort((a, b) => a.at.localeCompare(b.at));
  const line = (r: ToolRepair) => `• ${r.qty} x ${name(r.toolId)}: ${CONDITION_NAMES[r.condition].toLowerCase()}${r.note ? ` (${r.note})` : ""}`;
  const waiting = open.filter((r) => r.state === "waiting");
  const away = open.filter((r) => r.state === "away");
  return [
    `Lexington site: tools to fix (${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Accra" })})`,
    ...(waiting.length ? ["", "*To send out*", ...waiting.map(line)] : []),
    ...(away.length ? ["", "*At the repairer*", ...away.map((r) => `${line(r)}, sent ${onDay(r.sentAt ?? r.at)}${r.sentTo ? ` to ${r.sentTo}` : ""}`)] : []),
  ].join("\n");
}

/** The Tools tab's "Needs fixing": to send out (oldest first), then at the repairer. Nothing shows when nothing is. */
export function RepairsSection({ repairs, tools, onOpen, onCopy }: { repairs: ToolRepair[]; tools: StoreTool[]; onOpen: (id: string) => void; onCopy: () => void }) {
  const open = repairs.filter(isOpenRepair);
  if (!open.length) return null;
  const byId = new Map(tools.map((t) => [t.id, t]));
  const waiting = open.filter((r) => r.state === "waiting").sort((a, b) => a.at.localeCompare(b.at));
  const away = open.filter((r) => r.state === "away").sort((a, b) => (a.sentAt ?? "").localeCompare(b.sentAt ?? ""));
  const count = (list: ToolRepair[]) => list.reduce((n, r) => n + r.qty, 0);
  const row = (r: ToolRepair) => {
    const tool = byId.get(r.toolId);
    const photo = r.photoUrl ?? tool?.photoUrl ?? null;
    const since = daysSince(r.state === "away" ? (r.sentAt ?? r.at) : r.at);
    return (
      <button key={r.id} type="button" className={site.itemRow} onClick={() => onOpen(r.id)} aria-label={`To fix: ${tool?.name ?? GONE_TOOL}`}>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- a resized copy from the image store
          <img className={site.itemThumb} src={photoAt(photo, 120)} alt="" loading="lazy" />
        ) : (
          <span className={site.itemThumbEmpty} aria-hidden="true">
            <CameraIcon />
          </span>
        )}
        <span className={site.itemName}>
          {named(tool?.name ?? GONE_TOOL, r.qty)}
          <small>
            <span className={r.condition === "broken" ? site.condBad : site.condWorn}>{CONDITION_NAMES[r.condition]}</span>
            {r.note ? ` · ${r.note}` : ""}
          </small>
          <small>
            {r.state === "away" ? `At ${r.sentTo || "the repairer"} since ${onDay(r.sentAt ?? r.at)}` : `Since ${onDay(r.at)}${r.person ? ` · came back from ${r.person}` : ` · ${r.by}`}`}
          </small>
        </span>
        <span className={since >= 7 ? site.levelBad : since >= 3 ? site.levelLow : site.level}>
          {since === 0 ? (
            <small>today</small>
          ) : (
            <>
              {since} <small>{since === 1 ? "day" : "days"}</small>
            </>
          )}
        </span>
      </button>
    );
  };
  return (
    <section className={styles.group} aria-label="Needs fixing">
      <h2 className={styles.groupTitle}>
        Needs fixing <span>{count(open)}</span>
      </h2>
      {waiting.length > 0 && (
        <>
          <p className={site.repairHead}>To send out · {count(waiting)}</p>
          {waiting.map(row)}
        </>
      )}
      {away.length > 0 && (
        <>
          <p className={site.repairHead}>At the repairer · {count(away)}</p>
          {away.map(row)}
        </>
      )}
      <button type="button" className={site.copyList} onClick={onCopy}>
        Copy the list for WhatsApp
      </button>
    </section>
  );
}

/** One thing to fix: what's wrong, then sent out, back fixed, or (the office) written off; or taken off as a mistake. */
export function RepairSheet({
  repair: r,
  tool,
  me,
  onClose,
  onSaved,
  onDeleted,
  onOpenPhoto,
}: {
  repair: ToolRepair;
  tool: StoreTool | null;
  me: TodoMe;
  onClose: () => void;
  onSaved: (repair: ToolRepair | null, tool: StoreTool | null, text: string) => void;
  onDeleted: (id: string, tool: StoreTool | null) => void;
  onOpenPhoto: (url: string) => void;
}) {
  const isAdmin = me.kind === "admin";
  const name = tool?.name ?? GONE_TOOL;
  const [to, setTo] = useState(r.sentTo);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState<"scrap" | "delete" | null>(null);
  const [error, setError] = useState("");
  const open = isOpenRepair(r);
  const canDelete = open && (isAdmin || (r.mine && minutesSince(r.at) < UNDO_MINUTES));

  const act = async (body: Record<string, unknown>, text: string) => {
    setBusy(true);
    setError("");
    try {
      const { repair, tool: saved } = await send<{ repair: ToolRepair | null; tool: StoreTool | null }>(`/api/store/tools/repairs/${r.id}`, "PATCH", body);
      onSaved(repair, saved, text);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
      setArmed(null);
    }
  };
  const remove = async () => {
    setBusy(true);
    setError("");
    try {
      const { tool: saved } = await send<{ tool: StoreTool | null }>(`/api/store/tools/repairs/${r.id}`, "DELETE");
      onDeleted(r.id, saved);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
      setArmed(null);
    }
  };

  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label={`To fix: ${name}`}>
        <h2 className={styles.sheetTitle}>{named(name, r.qty)}</h2>
        <p className={styles.sheetNote}>
          <span className={r.condition === "broken" ? site.condBad : site.condWorn}>{CONDITION_NAMES[r.condition]}</span> · reported {onDay(r.at)} by {r.by}
          {r.person ? ` · came back from ${r.person}` : ""}
        </p>
        {r.note && <p className={site.repairNote}>{r.note}</p>}
        {r.photoUrl && (
          <button type="button" className={site.repairPhoto} onClick={() => onOpenPhoto(r.photoUrl!)} aria-label="Open the photo">
            {/* eslint-disable-next-line @next/next/no-img-element -- a resized copy from the image store */}
            <img src={photoAt(r.photoUrl, 600)} alt="" />
          </button>
        )}

        {r.state === "waiting" && (
          <>
            <label className={styles.label} htmlFor="repair-to">
              Who&rsquo;s fixing it (if you know)
            </label>
            <input id="repair-to" className={styles.input} value={to} onChange={(e) => setTo(e.target.value)} maxLength={MAX_REPAIRER} placeholder="e.g. Kwame at Abossey Okai" disabled={busy} />
            <button type="button" className={site.bigAction} onClick={() => void act({ action: "sent", to: to.trim() }, `Sent for repair: ${name}`)} disabled={busy}>
              Sent for repair
            </button>
            <button type="button" className={site.repairFixed} onClick={() => void act({ action: "fixed" }, `Fixed: ${name}`)} disabled={busy}>
              Fixed here: back in use
            </button>
          </>
        )}
        {r.state === "away" && (
          <>
            <p className={site.repairAway}>
              At {r.sentTo || "the repairer"} since {onDay(r.sentAt ?? r.at)}
              {r.sentBy ? ` (sent by ${r.sentBy})` : ""}
            </p>
            <button type="button" className={site.bigAction} onClick={() => void act({ action: "fixed" }, `Back fixed: ${name}`)} disabled={busy}>
              Back, fixed
            </button>
            <button type="button" className={styles.linkButton} onClick={() => void act({ action: "unsend" }, `${name}: back on the list to send out`)} disabled={busy}>
              It didn&rsquo;t go after all
            </button>
          </>
        )}
        {!open && (
          <p className={styles.sheetNote}>
            {r.state === "fixed" ? "Fixed" : "Written off"} {onDay(r.closedAt ?? r.at)}
            {r.closedBy ? ` by ${r.closedBy}` : ""}
          </p>
        )}
        {isAdmin && open && (
          <button
            type="button"
            className={armed === "scrap" ? `${site.repairScrap} ${styles.dangerArmed}` : site.repairScrap}
            onClick={() => (armed === "scrap" ? void act({ action: "scrap" }, `Written off: ${named(name, r.qty)}`) : setArmed("scrap"))}
            disabled={busy}
          >
            {armed === "scrap" ? `Tap again: ${r.qty} off how many we have` : "Can't be fixed: write it off"}
          </button>
        )}
        {canDelete && (
          <button type="button" className={armed === "delete" ? styles.dangerArmed : styles.linkButton} onClick={() => (armed === "delete" ? void remove() : setArmed("delete"))} disabled={busy}>
            {armed === "delete" ? "Tap again: take it off the list" : "Reported by mistake"}
          </button>
        )}
        {error && (
          <p className={styles.sheetError} role="alert">
            {error}
          </p>
        )}
        <button type="button" className={styles.sheetCancel} onClick={onClose} disabled={busy}>
          Close
        </button>
      </div>
    </div>
  );
}

/** Some of a tool found broken or needing repair: what's wrong, how many, a note and a photo if there is one. */
export function ReportSheet({ tool, onRepair, onClose, onSaved }: { tool: StoreTool; onRepair: number; onClose: () => void; onSaved: (repair: ToolRepair, tool: StoreTool) => void }) {
  const left = Math.max(0, tool.count - onRepair);
  const [condition, setCondition] = useState<"repair" | "broken" | null>(null);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { slot, start, clear, settled } = useUploadSlot("/api/store/photo");

  const save = async () => {
    if (!condition) return setError("Pick Needs repair or Broken.");
    setSaving(true);
    setError("");
    try {
      const photo = slot ? await settled() : null;
      const { repair, tool: saved } = await send<{ repair: ToolRepair; tool: StoreTool }>("/api/store/tools/repairs", "POST", {
        toolId: tool.id,
        qty,
        condition,
        note: note.trim(),
        photoId: photo?.id ?? null,
      });
      clear(true);
      onSaved(repair, saved);
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };
  const cancel = () => {
    clear();
    onClose();
  };

  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label={`Needs fixing: ${tool.name}`}>
        <h2 className={styles.sheetTitle}>{tool.name}: needs fixing</h2>
        <span className={styles.label}>What&rsquo;s wrong with it?</span>
        <div className={styles.chips} role="group" aria-label="What's wrong">
          {(["repair", "broken"] as const).map((c) => (
            <button key={c} type="button" className={condition === c ? site.chipBad : styles.chip} aria-pressed={condition === c} onClick={() => setCondition(c)} disabled={saving}>
              {CONDITION_NAMES[c]}
            </button>
          ))}
        </div>
        {left > 1 && (
          <>
            <span className={styles.label}>How many?</span>
            <Stepper value={qty} min={1} max={left} onChange={setQty} label="How many need fixing" />
          </>
        )}
        <label className={styles.label} htmlFor="repair-note">
          What happened (if you know)
        </label>
        <input id="repair-note" className={styles.input} value={note} onChange={(e) => setNote(e.target.value)} maxLength={MAX_MOVE_NOTE} placeholder="e.g. motor burnt, handle cracked" disabled={saving} />
        <PhotoField idBase="repair-report" slot={slot} onPick={start} onClear={() => clear()} label="A photo of it (if you can)" />
        {onRepair > 0 && (
          <p className={styles.sheetNote}>
            {onRepair} of {tool.count} {onRepair === 1 ? "is" : "are"} on the repair list already.
          </p>
        )}
        {error && (
          <p className={styles.sheetError} role="alert">
            {error}
          </p>
        )}
        <div className={styles.sheetButtons}>
          <button type="button" className={styles.sheetCancel} onClick={cancel} disabled={saving}>
            Cancel
          </button>
          <button type="button" className={styles.sheetSave} onClick={() => void save()} disabled={saving || !condition || left === 0}>
            {saving ? "Saving…" : "Put it on the repair list"}
          </button>
        </div>
      </div>
    </div>
  );
}
