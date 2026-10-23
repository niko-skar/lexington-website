"use client";

import { ghanaDay } from "@/lib/store/shared";
import { photoAt } from "@/lib/todo/shared";
import site from "./Site.module.css";
import styles from "./Todo.module.css";
import type { useUploadSlot } from "./useUploadSlot";

// Small pieces the store room's parts share: stock, tools, and opening and closing the store.

export const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
export const minutesSince = (iso: string) => (Date.now() - Date.parse(iso)) / 60_000;

/** The time on site (Ghana), whatever the phone's clock says. */
export const ghanaTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Accra" });

/** "Today", "Yesterday", "Monday 20 Oct" for a day in Ghana ("2026-10-20"). */
export function dayLabel(day: string) {
  if (day === ghanaDay()) return "Today";
  if (day === ghanaDay(Date.now() - 86_400_000)) return "Yesterday";
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
}

export const CameraIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);

/** A photo taken with an entry, small; tap for the big one. */
export function EntryPhoto({ url, onOpen }: { url: string | null | undefined; onOpen: (url: string) => void }) {
  if (!url) return null;
  return (
    <button type="button" className={site.entryThumb} onClick={() => onOpen(url)} aria-label="Open the photo">
      {/* eslint-disable-next-line @next/next/no-img-element -- a resized copy from the image store */}
      <img src={photoAt(url, 160)} alt="" loading="lazy" />
    </button>
  );
}

/** A photo to go with something (the store's own uploads). */
export function PhotoField({
  idBase,
  slot,
  onPick,
  onClear,
  required,
  cameraOnly,
  label,
  need = "A photo of the stock going out is needed.",
}: {
  idBase: string;
  slot: ReturnType<typeof useUploadSlot>["slot"];
  onPick: (file: File) => void;
  onClear: () => void;
  required?: boolean;
  cameraOnly?: boolean;
  label: string;
  /** What a required photo is for. */
  need?: string;
}) {
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) onPick(file);
  };
  return (
    <div className={site.photoBox}>
      <span className={styles.label}>{label}</span>
      {slot ? (
        <>
          <span className={site.photoPreview}>
            {/* eslint-disable-next-line @next/next/no-img-element -- the phone's own preview of the photo */}
            <img src={slot.preview} alt="" />
          </span>
          <p className={slot.state === "error" ? styles.slotError : site.photoState}>
            {slot.state === "uploading" ? "Uploading the photo…" : slot.state === "ready" ? "Photo ready" : slot.error}
          </p>
          <div className={styles.slotButtons}>
            <label htmlFor={`${idBase}-camera`} role="button" tabIndex={0}>
              Retake
            </label>
            {!required && (
              <button type="button" onClick={onClear}>
                Remove photo
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          {required && <p className={site.photoNeeded}>{need}</p>}
          <div className={styles.slotButtons}>
            <label htmlFor={`${idBase}-camera`} role="button" tabIndex={0}>
              📷 Take photo
            </label>
            {!cameraOnly && (
              <label htmlFor={`${idBase}-gallery`} role="button" tabIndex={0}>
                From the gallery
              </label>
            )}
          </div>
        </>
      )}
      <input id={`${idBase}-camera`} data-picker={`${idBase}-camera`} className={styles.hiddenInput} type="file" accept="image/*" capture="environment" onChange={pick} />
      {!cameraOnly && <input id={`${idBase}-gallery`} data-picker={`${idBase}-gallery`} className={styles.hiddenInput} type="file" accept="image/*" onChange={pick} />}
    </div>
  );
}

/** − 2 + for whole numbers (tools). With min 0, the − on 1 takes it off. */
export function Stepper({ value, min = 1, max, onChange, label }: { value: number; min?: number; max?: number; onChange: (n: number) => void; label: string }) {
  return (
    <span className={site.stepper} role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="One less">
        −
      </button>
      <span className={site.stepperValue}>{value}</span>
      <button type="button" onClick={() => onChange(max === undefined ? value + 1 : Math.min(max, value + 1))} disabled={max !== undefined && value >= max} aria-label="One more">
        +
      </button>
    </span>
  );
}
