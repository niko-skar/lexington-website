"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import { PHOTO_KIND_NAMES, PHOTO_KINDS, type PourPhoto, type PourPhotoKind } from "@/lib/concrete/pourExtras";
import type { ConcreteData } from "@/lib/concrete/shared";
import { photoAt, type TodoMe } from "@/lib/todo/shared";
import { errorText, send, when } from "./api";
import { addPourPhotos, dropPourUpload, onPourUploads, pourUploads, retryPourUpload, type PourUpload } from "./pourPhotoQueue";
import ps from "./Pours.module.css";
import styles from "./Todo.module.css";

// A pour's pre-pour photos (lib/concrete/pourExtras.ts says what and why): the steel, the pipes and sleeves, anything
// else, each kept at full size. Picked many at a time from the phone's photos (or taken here); each shows as soon as
// its small copy is made, and they go up in turn (pourPhotoQueue.ts).

const NONE: PourUpload[] = [];

function usePourUploads(pourId: string): PourUpload[] {
  const all = useSyncExternalStore(onPourUploads, pourUploads, () => NONE);
  return all.filter((u) => u.pourId === pourId);
}

export function PourPhotos({
  pourId,
  photos,
  me,
  onData,
  onToast,
}: {
  pourId: string;
  /** Every pour's photos (this one's are picked out). */
  photos: PourPhoto[];
  me: TodoMe;
  onData: (data: ConcreteData) => void;
  onToast: (text: string, error?: boolean) => void;
}) {
  const id = useId();
  const [kind, setKind] = useState<PourPhotoKind>("steel");
  const [open, setOpen] = useState<string | null>(null);
  const uploads = usePourUploads(pourId);
  // In the order they show: steel first, then pipes, then the rest; each by the time it was taken.
  const mine = PHOTO_KINDS.flatMap((k) => photos.filter((p) => p.pourId === pourId && p.kind === k));
  const kinds = PHOTO_KINDS.filter((k) => mine.some((p) => p.kind === k) || uploads.some((u) => u.kind === k));
  const going = uploads.filter((u) => u.state !== "error").length;
  const failed = uploads.filter((u) => u.state === "error");
  const index = open ? mine.findIndex((p) => p.id === open) : -1;

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    addPourPhotos(pourId, kind, files);
  };

  return (
    <div className={ps.photos}>
      <p className={ps.progress}>Pre-pour photos{mine.length ? `: ${mine.length}` : ""}</p>
      <div className={styles.chips} role="group" aria-label="What the next photos show">
        {PHOTO_KINDS.map((k) => (
          <button key={k} type="button" className={kind === k ? styles.chipOn : styles.chip} aria-pressed={kind === k} onClick={() => setKind(k)}>
            {PHOTO_KIND_NAMES[k]}
          </button>
        ))}
      </div>
      <div className={ps.photoButtons}>
        <label htmlFor={`${id}-cam`} className={ps.photoAdd} role="button" tabIndex={0}>
          <span aria-hidden="true">📷</span> Take
        </label>
        <label htmlFor={`${id}-pick`} className={ps.photoPick} role="button" tabIndex={0}>
          Add from photos
        </label>
      </div>
      {/* "capture" opens the camera; the other picks many at once from the phone's photos. */}
      <input id={`${id}-cam`} className={styles.hiddenInput} type="file" accept="image/*" capture="environment" onChange={pick} />
      <input id={`${id}-pick`} className={styles.hiddenInput} type="file" accept="image/*" multiple onChange={pick} />
      {going > 0 && (
        <p className={ps.photoNote} role="status">
          {going === 1 ? "1 photo" : `${going} photos`} going up at full size: keep the app open until they&rsquo;re in.
        </p>
      )}
      {kinds.map((k) => (
        <div key={k}>
          <p className={ps.kindTitle}>
            {PHOTO_KIND_NAMES[k]} <span>{mine.filter((p) => p.kind === k).length || ""}</span>
          </p>
          <div className={ps.thumbs}>
            {mine
              .filter((p) => p.kind === k)
              .map((p) => (
                <button key={p.id} type="button" className={ps.thumb} onClick={() => setOpen(p.id)} aria-label={`${PHOTO_KIND_NAMES[k]} photo, ${when(p.takenAt)}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- the image store's own resizing */}
                  {p.previewUrl ? <img src={photoAt(p.previewUrl, 240)} alt="" loading="lazy" /> : null}
                </button>
              ))}
            {uploads
              .filter((u) => u.kind === k)
              .map((u) => (
                <div key={u.key} className={u.state === "error" ? `${ps.thumb} ${ps.thumbError}` : `${ps.thumb} ${ps.thumbUp}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- the phone's own preview of the photo */}
                  {u.preview ? <img src={u.preview} alt="" /> : null}
                  {u.state === "error" ? (
                    <span className={ps.thumbBar}>
                      <button type="button" onClick={() => retryPourUpload(u.key)} aria-label="Try that photo again">
                        ↻
                      </button>
                      <button type="button" onClick={() => dropPourUpload(u.key)} aria-label="Take that photo off">
                        ✕
                      </button>
                    </span>
                  ) : (
                    <span className={ps.thumbPct}>{u.state === "waiting" ? "Waiting" : `${u.percent}%`}</span>
                  )}
                </div>
              ))}
          </div>
        </div>
      ))}
      {failed.length > 0 && (
        <p className={ps.photoError} role="alert">
          {failed.length === 1 ? "1 photo" : `${failed.length} photos`} didn&rsquo;t go up: {failed[0].error} Tap ↻ to try again.
        </p>
      )}
      {!mine.length && !uploads.length && (
        <p className={ps.hint}>Before the pour: the steel all over, then the pipes and sleeves. Pick many at once from your photos; each is kept at full size.</p>
      )}
      {index >= 0 && (
        <PhotoViewer
          photos={mine}
          index={index}
          me={me}
          onMove={(step) => setOpen(mine[Math.min(mine.length - 1, Math.max(0, index + step))].id)}
          onClose={() => setOpen(null)}
          onDeleted={(data) => {
            onData(data);
            onToast("Photo deleted");
            const next = mine[index + 1] ?? mine[index - 1];
            setOpen(next ? next.id : null);
          }}
          onError={(text) => onToast(text, true)}
        />
      )}
    </div>
  );
}

/** One photo large: swipe (or the arrows) for the next; the original at full size; deleted by the office or whoever added it. */
function PhotoViewer({
  photos,
  index,
  me,
  onMove,
  onClose,
  onDeleted,
  onError,
}: {
  photos: PourPhoto[];
  index: number;
  me: TodoMe;
  onMove: (step: number) => void;
  onClose: () => void;
  onDeleted: (data: ConcreteData) => void;
  onError: (text: string) => void;
}) {
  const p = photos[index];
  // "Tap again to delete" is for the photo it was tapped on (moving on to the next one disarms it).
  const [armedFor, setArmedFor] = useState<string | null>(null);
  const armed = armedFor === p.id;
  const [busy, setBusy] = useState(false);
  const startX = useRef<number | null>(null);
  const swiped = useRef(false);
  const canDelete = me.kind === "admin" || p.by === me.name;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") onMove(-1);
      else if (e.key === "ArrowRight") onMove(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onMove]);

  const remove = async () => {
    if (!armed) return setArmedFor(p.id);
    setBusy(true);
    try {
      onDeleted(await send<ConcreteData>("/api/concrete/pours", "POST", { action: "photoDelete", id: p.id }));
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
      setArmedFor(null);
    }
  };

  return (
    <div
      className={styles.lightbox}
      role="dialog"
      aria-label="Pre-pour photo"
      onPointerDown={(e) => {
        startX.current = e.clientX;
        swiped.current = false;
      }}
      onPointerUp={(e) => {
        const dx = startX.current === null ? 0 : e.clientX - startX.current;
        startX.current = null;
        if (Math.abs(dx) < 60) return;
        swiped.current = true;
        onMove(dx < 0 ? 1 : -1);
      }}
      onClick={() => {
        if (swiped.current) swiped.current = false;
        else onClose();
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- the image store's copy, large */}
      {p.previewUrl ? <img key={p.id} src={photoAt(p.previewUrl, 1600)} alt={`${PHOTO_KIND_NAMES[p.kind]} photo`} draggable={false} /> : <span />}
      <div className={ps.viewerBar} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
        <p className={ps.viewerCaption}>
          {PHOTO_KIND_NAMES[p.kind]} · {index + 1} of {photos.length} · {when(p.takenAt)}
          {p.by ? ` · ${p.by}` : ""}
        </p>
        <div className={ps.viewerButtons}>
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Previous photo">
            ‹
          </button>
          <a href={`/api/concrete/pour-photo/${p.id}`} target="_blank" rel="noreferrer">
            Full size
          </a>
          {canDelete && (
            <button type="button" className={armed ? ps.viewerArmed : undefined} onClick={() => void remove()} disabled={busy}>
              {busy ? "Deleting…" : armed ? "Tap again to delete" : "Delete"}
            </button>
          )}
          <button type="button" onClick={() => onMove(1)} disabled={index === photos.length - 1} aria-label="Next photo">
            ›
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
