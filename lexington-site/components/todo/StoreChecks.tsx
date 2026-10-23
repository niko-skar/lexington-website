"use client";

import { useMemo, useState } from "react";

import { ghanaDay, MAX_CHECK_PHOTOS, MAX_MOVE_NOTE, stillOut, toolWord, UNDO_MINUTES, type CheckKind, type StoreCheck, type ToolOut } from "@/lib/store/shared";
import { photoAt, type TodoMe } from "@/lib/todo/shared";
import { errorText, send } from "./api";
import site from "./Site.module.css";
import { CameraIcon, dayLabel, ghanaTime, minutesSince } from "./StoreBits";
import styles from "./Todo.module.css";
import { usePhotoList } from "./usePhotoList";

// Opening and closing the store room with photos (Niko, 23 Oct 2026: "daily pictures of opening
// store room and closing store room"): a strip at the top of the store says how it stands today,
// with the button for the next one; tapping it shows every day's photos.

const photoWord = (n: number) => (n === 1 ? "photo" : "photos");

/** How the store room stands today, and the button to open or close it. */
export function CheckStrip({ checks, onCheck, onDays }: { checks: StoreCheck[]; onCheck: (kind: CheckKind) => void; onDays: () => void }) {
  const today = ghanaDay();
  const last = checks[0] && ghanaDay(checks[0].at) === today ? checks[0] : null;
  // The last one before today was an opening: that day ended without closing photos.
  const before = checks.find((c) => ghanaDay(c.at) < today);
  const leftOpen = before?.kind === "open" ? dayLabel(ghanaDay(before.at)) : null;
  const state = last?.kind ?? "none";
  return (
    <div className={state === "open" ? site.checkOpen : state === "close" ? site.checkClosed : site.checkNone}>
      <button type="button" className={site.checkText} onClick={onDays} aria-label="Opening and closing photos, day by day">
        <b>{!last ? "Store room not opened today" : last.kind === "open" ? `Open since ${ghanaTime(last.at)}` : `Closed at ${ghanaTime(last.at)}`}</b>
        <small>
          {last ? `${last.by} · ${last.photoUrls.length} ${photoWord(last.photoUrls.length)} · all days` : "Take photos as you open it"}
          {leftOpen ? ` · not closed ${leftOpen === "Yesterday" ? "yesterday" : `on ${leftOpen}`}` : ""}
        </small>
      </button>
      <button type="button" className={site.checkButton} onClick={() => onCheck(state === "open" ? "close" : "open")}>
        {state === "open" ? "Close" : state === "close" ? "Open again" : "Open"}
      </button>
    </div>
  );
}

/** Opening or closing: photos there and then (the camera only), and a note if need be. */
export function CheckSheet({
  kind,
  outs,
  name,
  onClose,
  onSaved,
  onSignedOut,
}: {
  kind: CheckKind;
  /** The take-outs the page has: closing lists the tools still out. */
  outs: ToolOut[];
  name: (toolId: string) => string;
  onClose: () => void;
  onSaved: (check: StoreCheck) => void;
  onSignedOut: () => void;
}) {
  const { photos, add, remove, clear, settled } = usePhotoList("/api/store/photo");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const uploading = photos.some((p) => p.state === "uploading");
  const failed = photos.some((p) => p.state === "error");
  const stillOutLines = kind === "close" ? outs.filter((o) => !o.closedAt && stillOut(o) > 0) : [];
  const outCount = stillOutLines.reduce((n, o) => n + stillOut(o), 0);
  const title = kind === "open" ? "Open the store room" : "Close the store room";

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) add(file);
  };

  const save = async () => {
    setError("");
    if (photos.length === 0) return setError(`Take a photo of the store room as you ${kind} it first.`);
    setSaving(true);
    try {
      const ids = await settled();
      if (!ids) return setError("A photo didn't upload: take it off (✕) and take it again.");
      const { check } = await send<{ check: StoreCheck }>("/api/store/checks", "POST", { kind, photoIds: ids, note: note.trim() });
      clear(true);
      onSaved(check);
    } catch (e) {
      if ((e as { status?: number }).status === 401) onSignedOut();
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label={title}>
        <h2 className={styles.sheetTitle}>{title}</h2>
        <p className={styles.sheetNote}>
          {kind === "open"
            ? "Take photos as you open it: the door, then the shelves, so the store can be seen as it was found."
            : "Take photos as you close it: the shelves, then the door locked."}{" "}
          Up to {MAX_CHECK_PHOTOS}.
        </p>
        <div className={site.photoGrid}>
          {photos.map((p, i) => (
            <div key={p.key} className={site.photoTile}>
              {/* eslint-disable-next-line @next/next/no-img-element -- the phone's own preview of the photo */}
              <img src={p.preview} alt={`Photo ${i + 1}`} />
              <span className={p.state === "error" ? site.photoTileError : site.photoTileState}>
                {p.state === "uploading" ? "Uploading…" : p.state === "ready" ? "Ready" : "Didn't upload"}
              </span>
              <button type="button" className={site.photoTileOff} onClick={() => remove(p.key)} aria-label={`Take photo ${i + 1} off`}>
                ✕
              </button>
            </div>
          ))}
          {photos.length < MAX_CHECK_PHOTOS && (
            <label htmlFor="check-camera" className={site.photoTileAdd} role="button" tabIndex={0}>
              <CameraIcon />
              {photos.length ? "Another photo" : "Take a photo"}
            </label>
          )}
        </div>
        <input id="check-camera" data-picker="check-camera" className={styles.hiddenInput} type="file" accept="image/*" capture="environment" onChange={pick} />
        {stillOutLines.length > 0 && (
          <p className={site.gapOdd}>
            Still out: {stillOutLines.map((o) => `${name(o.toolId)}${stillOut(o) > 1 ? ` ×${stillOut(o)}` : ""} (${o.person})`).join(", ")}. {outCount === 1 ? "It shows" : "They show"}{" "}
            as not back from tomorrow.
          </p>
        )}
        <label className={styles.label} htmlFor="check-note">
          Note (optional)
        </label>
        <input
          id="check-note"
          className={styles.input}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={MAX_MOVE_NOTE}
          autoComplete="off"
          placeholder={kind === "open" ? "e.g. Padlock was already open" : "e.g. Generator left outside, chained"}
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
          <button type="button" className={styles.sheetSave} onClick={() => void save()} disabled={saving || photos.length === 0 || uploading || failed}>
            {saving
              ? "Saving…"
              : photos.length === 0
                ? "Take a photo first"
                : uploading
                  ? "Uploading the photos…"
                  : failed
                    ? "A photo didn't upload"
                    : kind === "open"
                      ? "Save: store room open"
                      : "Save: store room closed"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Every day's opening and closing photos, newest day first; a day left without closing photos in red. */
export function DaysSheet({
  me,
  checks,
  older,
  onOlder,
  onClose,
  onUndo,
  onOpenPhoto,
}: {
  me: TodoMe;
  checks: StoreCheck[];
  /** "more": there may be older days; "loading"; "end": nothing older. */
  older: "more" | "loading" | "end";
  onOlder: () => void;
  onClose: () => void;
  onUndo: (check: StoreCheck) => void;
  onOpenPhoto: (url: string) => void;
}) {
  const isAdmin = me.kind === "admin";
  const [armed, setArmed] = useState<string | null>(null);
  const days = useMemo(() => {
    const groups: { day: string; checks: StoreCheck[] }[] = [];
    for (const c of checks) {
      const day = ghanaDay(c.at);
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.checks.unshift(c);
      else groups.push({ day, checks: [c] });
    }
    return groups;
  }, [checks]);
  const today = ghanaDay();
  const canUndo = (c: StoreCheck) => isAdmin || (c.mine && minutesSince(c.at) < UNDO_MINUTES);

  return (
    <div className={styles.sheetBackdrop} onClick={onClose}>
      <div className={`${styles.sheet} ${site.sheetTall}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Opening and closing">
        <h2 className={styles.sheetTitle}>Opening and closing</h2>
        <p className={styles.sheetNote}>The photos taken as the store room was opened and closed, day by day.</p>
        {days.length === 0 && <p className={styles.sheetNote}>Nothing yet: the first photos come when the store room is next opened.</p>}
        {days.map((d) => {
          const lastKind = d.checks[d.checks.length - 1].kind;
          const flag = lastKind === "open" ? (d.day < today ? "Not closed: no closing photos" : "Open now") : null;
          return (
            <section key={d.day} className={site.checkDay}>
              <h3 className={styles.groupTitle}>
                {dayLabel(d.day)}
                {flag && <em className={d.day < today ? site.dayFlagBad : site.dayFlagOk}>{flag}</em>}
              </h3>
              {d.checks.map((c) => (
                <article key={c.id} className={site.checkEntry}>
                  <div className={site.checkEntryTop}>
                    <p className={site.entryHead}>
                      {c.kind === "open" ? "Opened" : "Closed"} {ghanaTime(c.at)} · {c.by}
                    </p>
                    {canUndo(c) && (
                      <button
                        type="button"
                        className={armed === c.id ? styles.dangerArmed : site.entryUndo}
                        onClick={() => (armed === c.id ? onUndo(c) : setArmed(c.id))}
                      >
                        {armed === c.id ? "Tap again" : isAdmin ? "Remove" : "Undo"}
                      </button>
                    )}
                  </div>
                  {c.kind === "close" && c.toolsOut ? (
                    <p className={`${site.entrySub} ${site.entryOdd}`}>
                      {c.toolsOut} {toolWord(c.toolsOut)} still out at closing
                    </p>
                  ) : null}
                  {c.note && <p className={site.entrySub}>&ldquo;{c.note}&rdquo;</p>}
                  <div className={site.checkThumbs}>
                    {c.photoUrls.map((url, i) => (
                      <button key={url} type="button" onClick={() => onOpenPhoto(url)} aria-label={`Open photo ${i + 1}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- a resized copy from the image store */}
                        <img src={photoAt(url, 200)} alt="" loading="lazy" />
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </section>
          );
        })}
        {days.length > 0 && older !== "end" && (
          <button type="button" className={styles.linkButton} onClick={onOlder} disabled={older === "loading"}>
            {older === "loading" ? "Loading…" : "Show older days"}
          </button>
        )}
        <button type="button" className={styles.sheetCancel} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
