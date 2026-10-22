"use client";

import { useRef, useState, useTransition } from "react";

import crm from "@/components/crm/Crm.module.css";
import { draftProgressAction, publishProgressAction } from "@/lib/actions/progress";
import type { ProgressDraft } from "@/lib/agents/progress";
import { facebookCaption, instagramCaption } from "@/lib/agents/progressCore";
import { SITE_URL } from "@/lib/seo";
import type { PlatformResult } from "@/lib/social/types";

import styles from "./Progress.module.css";

// The most one post can carry (Instagram's limit for a swipe-through post).
const MAX_PHOTOS = 10;
// Photos are made smaller on the phone before sending: quicker on mobile data,
// and still sharper than anything Facebook, Instagram or the website shows.
const LONG_SIDE = 2400;

interface Photo {
  key: string;
  preview: string;
  status: "shrinking" | "uploading" | "ready" | "failed";
  assetId?: string;
  error?: string;
}

const newReportId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height };
  } catch {
    // Older Safari: an <img> decodes what createImageBitmap won't.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { source: img, width: img.naturalWidth, height: img.naturalHeight };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** A JPEG at most LONG_SIDE pixels long (this also drops the phone's location data from the file). */
async function shrink(file: File): Promise<Blob> {
  const { source, width, height } = await decode(file);
  const scale = Math.min(1, LONG_SIDE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  const encode = (quality: number) =>
    new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The photo could not be read."))), "image/jpeg", quality));
  const blob = await encode(0.85);
  return blob.size > 4_000_000 ? encode(0.7) : blob;
}

export function ProgressReporter({ stages, aiOn, socialOn }: { stages: string[]; aiOn: boolean; socialOn: boolean }) {
  const [reportId, setReportId] = useState(newReportId);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [stage, setStage] = useState(stages[0] ?? "");
  const [note, setNote] = useState("");
  const [targets, setTargets] = useState({ website: true, facebook: socialOn, instagram: socialOn });
  const [draft, setDraft] = useState<ProgressDraft | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [alts, setAlts] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [results, setResults] = useState<{ website?: PlatformResult; fb?: PlatformResult; ig?: PlatformResult } | null>(null);
  const [writing, startWriting] = useTransition();
  const [publishing, startPublishing] = useTransition();
  const input = useRef<HTMLInputElement | null>(null);

  const ready = photos.filter((p) => p.status === "ready");
  const busy = photos.some((p) => p.status === "shrinking" || p.status === "uploading");
  const update = (key: string, patch: Partial<Photo>) => setPhotos((all) => all.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  async function upload(photo: Photo, file: File) {
    try {
      const blob = await shrink(file);
      update(photo.key, { status: "uploading" });
      const form = new FormData();
      form.set("photo", new File([blob], "site.jpg", { type: "image/jpeg" }));
      const response = await fetch("/api/admin/progress/upload", { method: "POST", body: form });
      const body = (await response.json().catch(() => ({}))) as { assetId?: string; error?: string };
      if (!response.ok || !body.assetId) throw new Error(body.error || "The photo could not be sent.");
      update(photo.key, { status: "ready", assetId: body.assetId });
    } catch (e) {
      update(photo.key, { status: "failed", error: e instanceof Error ? e.message : "The photo could not be sent." });
    }
  }

  async function add(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    const room = MAX_PHOTOS - photos.length;
    const picked = [...files].slice(0, Math.max(0, room));
    if (files.length > room) setError(`One post can carry ${MAX_PHOTOS} photos: the first ${room} were added.`);
    const fresh = picked.map((file) => ({
      file,
      photo: { key: crypto.randomUUID(), preview: URL.createObjectURL(file), status: "shrinking" as const },
    }));
    setPhotos((all) => [...all, ...fresh.map((f) => f.photo)]);
    if (input.current) input.current.value = "";
    // Two at a time: quick, without choking a phone's connection.
    for (let i = 0; i < fresh.length; i += 2) {
      await Promise.all(fresh.slice(i, i + 2).map((f) => upload(f.photo, f.file)));
    }
  }

  function remove(key: string) {
    setPhotos((all) => all.filter((p) => p.key !== key));
    setDraft(null);
  }

  function write() {
    setError("");
    startWriting(async () => {
      const result = await draftProgressAction({ assetIds: ready.map((p) => p.assetId!), note, stage });
      if (!result.ok) return setError(result.error);
      setDraft(result.draft);
      setTitle(result.draft.title);
      setText(result.draft.text);
      setAlts(result.draft.alts);
    });
  }

  function publish() {
    const where = [targets.website && "the website", targets.facebook && "Facebook", targets.instagram && "Instagram"].filter(Boolean).join(", ");
    if (!window.confirm(`Post this update to ${where}?`)) return;
    setError("");
    startPublishing(async () => {
      const result = await publishProgressAction({
        reportId,
        photos: ready.map((p, i) => ({ assetId: p.assetId!, alt: alts[i] ?? "" })),
        title,
        text,
        stage,
        targets,
      });
      if (!result.ok) return setError(result.error);
      setResults(result.result);
    });
  }

  function startAgain() {
    photos.forEach((p) => URL.revokeObjectURL(p.preview));
    setPhotos([]);
    setNote("");
    setDraft(null);
    setResults(null);
    setError("");
    setReportId(newReportId());
  }

  const allDone =
    results &&
    (!targets.website || results.website?.ok) &&
    (!targets.facebook || results.fb?.ok) &&
    (!targets.instagram || results.ig?.ok);

  return (
    <section className={crm.panel} aria-label="Post a site update">
      <h2 className={crm.panelTitle}>Post a site update</h2>

      <label className={styles.addPhotos}>
        <input ref={input} type="file" accept="image/*" multiple onChange={(e) => void add(e.target.files)} disabled={Boolean(results)} />
        {photos.length ? "＋ Add more photos" : "＋ Add photos from your phone"}
      </label>

      {photos.length > 0 && (
        <div className={styles.photos}>
          {photos.map((p) => (
            <div key={p.key} className={styles.photo}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of a photo not uploaded yet */}
              <img src={p.preview} alt="" />
              {p.status !== "ready" && (
                <span className={p.status === "failed" ? styles.photoFailed : styles.photoState}>
                  {p.status === "failed" ? "Not sent" : p.status === "uploading" ? "Sending…" : "Preparing…"}
                </span>
              )}
              {!results && (
                <button type="button" className={styles.remove} aria-label="Remove this photo" onClick={() => remove(p.key)}>
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {photos.some((p) => p.status === "failed") && (
        <p className={crm.formMsgErr}>{photos.find((p) => p.status === "failed")?.error} Remove it and add it again.</p>
      )}

      <div className={crm.formGrid} style={{ marginTop: 16 }}>
        <div className={crm.field}>
          <label htmlFor="p-stage">Construction stage</label>
          <input id="p-stage" list="p-stages" value={stage} onChange={(e) => setStage(e.target.value)} placeholder="e.g. Second Floor" maxLength={60} />
          <datalist id="p-stages">
            {stages.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
      </div>
      <div className={crm.field} style={{ marginBottom: 14 }}>
        <label htmlFor="p-note">What&apos;s new on site? (optional)</label>
        <textarea
          id="p-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Second floor slab poured this week, columns for the third floor going up."
          maxLength={1000}
        />
      </div>

      <div className={styles.targets} role="group" aria-label="Post to">
        {(
          [
            ["website", "Website"],
            ["facebook", "Facebook"],
            ["instagram", "Instagram"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={targets[key]}
              disabled={Boolean(results) || (key !== "website" && !socialOn)}
              onChange={(e) => setTargets((t) => ({ ...t, [key]: e.target.checked }))}
            />
            {label}
          </label>
        ))}
      </div>
      {!socialOn && <p className={crm.sectionHint}>Facebook and Instagram aren&apos;t connected on this copy of the site.</p>}

      {!results && (
        <button type="button" className={crm.btnPrimary} onClick={write} disabled={!ready.length || busy || writing}>
          {writing ? "Writing… (up to a minute)" : busy ? "Sending photos…" : draft ? "Write it again" : "Write the update"}
        </button>
      )}
      {!aiOn && !draft && (
        <p className={crm.sectionHint} style={{ marginTop: 10 }}>
          Claude isn&apos;t connected yet, so the update uses your note as you write it.
        </p>
      )}

      {draft && (
        <div className={styles.step}>
          {draft.warnings.length > 0 && (
            <div className={crm.checkBox} role="note">
              <strong>Check before posting</strong>
              <ul>
                {draft.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          <div className={crm.field} style={{ marginBottom: 12 }}>
            <label htmlFor="p-title">Title</label>
            <input id="p-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={90} disabled={Boolean(results)} />
          </div>
          <div className={crm.field} style={{ marginBottom: 12 }}>
            <label htmlFor="p-text">Text</label>
            <textarea id="p-text" value={text} onChange={(e) => setText(e.target.value)} maxLength={600} disabled={Boolean(results)} />
          </div>

          <details className={crm.replyMore}>
            <summary>Photo descriptions (for people who can&apos;t see them)</summary>
            {ready.map((p, i) => (
              <div key={p.key} className={crm.field} style={{ marginBottom: 8 }}>
                <label htmlFor={`p-alt-${i}`}>Photo {i + 1}</label>
                <input
                  id={`p-alt-${i}`}
                  value={alts[i] ?? ""}
                  maxLength={160}
                  disabled={Boolean(results)}
                  onChange={(e) => setAlts((all) => all.map((a, j) => (j === i ? e.target.value : a)))}
                />
              </div>
            ))}
          </details>

          {(targets.facebook || targets.instagram) && (
            <details className={crm.replyMore}>
              <summary>How the post will read</summary>
              {targets.facebook && (
                <>
                  <p className={crm.sectionHint} style={{ margin: "6px 0" }}>
                    Facebook
                  </p>
                  <div className={styles.caption}>{facebookCaption({ title, text }, reportId)}</div>
                </>
              )}
              {targets.instagram && (
                <>
                  <p className={crm.sectionHint} style={{ margin: "10px 0 6px" }}>
                    Instagram (photos cropped to 4:5)
                  </p>
                  <div className={styles.caption}>{instagramCaption({ title, text })}</div>
                </>
              )}
            </details>
          )}

          {!allDone && (
            <div className={crm.replyActions}>
              <button type="button" className={crm.btnPrimary} onClick={publish} disabled={publishing || !title.trim() || !text.trim() || !stage.trim()}>
                {publishing ? "Posting… (up to two minutes)" : results ? "Try the rest again" : "Publish"}
              </button>
            </div>
          )}
          <p className={crm.writerNote}>
            {draft.writer === "claude" ? "Written by Claude from your photos and note." : "Your note, as you wrote it."}
            {draft.note ? ` ${draft.note}` : ""}
          </p>
        </div>
      )}

      {results && (
        <ul className={styles.results}>
          {targets.website && (
            <li className={results.website?.ok ? styles.ok : styles.bad}>
              {results.website?.ok ? (
                <>
                  ✓ Website: <a href={`${SITE_URL}/progress`} target="_blank" rel="noreferrer">progress page</a>
                </>
              ) : (
                `✗ Website: ${results.website?.error ?? "not posted"}`
              )}
            </li>
          )}
          {targets.facebook && (
            <li className={results.fb?.ok ? styles.ok : styles.bad}>
              {results.fb?.ok ? (
                <>
                  ✓ Facebook: <a href={results.fb.url} target="_blank" rel="noreferrer">the post</a>
                </>
              ) : (
                `✗ Facebook: ${results.fb?.error ?? "not posted"}`
              )}
            </li>
          )}
          {targets.instagram && (
            <li className={results.ig?.ok ? styles.ok : styles.bad}>
              {results.ig?.ok ? (
                <>✓ Instagram{results.ig.url ? <>: <a href={results.ig.url} target="_blank" rel="noreferrer">the post</a></> : " (posted)"}</>
              ) : (
                `✗ Instagram: ${results.ig?.error ?? "not posted"}`
              )}
            </li>
          )}
        </ul>
      )}
      {allDone && (
        <div className={crm.replyActions}>
          <button type="button" className={crm.btn} onClick={startAgain}>
            Post another update
          </button>
        </div>
      )}

      {error && <p className={crm.formMsgErr}>{error}</p>}
    </section>
  );
}
