"use client";

import { CONDITION_NAMES, CONDITIONS, ghanaDay, MAX_UNIT, needsFixing, TRADE_NAMES, TRADES, UNITS, type Condition, type Trade } from "@/lib/store/shared";
import { photoAt } from "@/lib/todo/shared";
import site from "./Site.module.css";
import styles from "./Todo.module.css";
import { slotWords, type useUploadSlot } from "./useUploadSlot";

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
  pdf,
  label,
  need = "A photo of the stock going out is needed.",
}: {
  idBase: string;
  slot: ReturnType<typeof useUploadSlot>["slot"];
  onPick: (file: File) => void;
  onClear: () => void;
  required?: boolean;
  cameraOnly?: boolean;
  /** A PDF will do too (a supplier's bill). */
  pdf?: boolean;
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
          {slot.pdf ? (
            <span className={site.preview}>
              <span className={site.pdf}>PDF</span>
              <span className={site.pdfName}>{slot.name || "The PDF"}</span>
            </span>
          ) : (
            <span className={site.photoPreview}>
              {/* eslint-disable-next-line @next/next/no-img-element -- the phone's own preview of the photo */}
              <img src={slot.preview} alt="" />
            </span>
          )}
          <p className={slot.state === "error" && slot.final ? styles.slotError : site.photoState}>{slotWords(slot)}</p>
          <div className={styles.slotButtons}>
            <label htmlFor={`${idBase}-${slot.pdf && !cameraOnly ? "gallery" : "camera"}`} role="button" tabIndex={0}>
              {slot.pdf ? "Pick another" : "Retake"}
            </label>
            {!required && (
              <button type="button" onClick={onClear}>
                {slot.pdf ? "Remove PDF" : "Remove photo"}
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
                {pdf ? "Upload photo or PDF" : "From the gallery"}
              </label>
            )}
          </div>
        </>
      )}
      <input id={`${idBase}-camera`} data-picker={`${idBase}-camera`} className={styles.hiddenInput} type="file" accept="image/*" capture="environment" onChange={pick} />
      {!cameraOnly && (
        <input id={`${idBase}-gallery`} data-picker={`${idBase}-gallery`} className={styles.hiddenInput} type="file" accept={pdf ? "image/*,application/pdf" : "image/*"} onChange={pick} />
      )}
    </div>
  );
}

/* ---------- who uses it, and the state a tool is in (Niko, 3 Nov 2026) ---------- */

/** Who uses it: one of the trades, or everyone. */
export function TradeChips({ value, onChange }: { value: Trade; onChange: (t: Trade) => void }) {
  return (
    <>
      <span className={styles.label}>Who uses it?</span>
      <div className={styles.chips} role="group" aria-label="Who uses it">
        {TRADES.map((t) => (
          <button key={t} type="button" className={value === t ? styles.chipOn : styles.chip} aria-pressed={value === t} onClick={() => onChange(t)}>
            {TRADE_NAMES[t]}
          </button>
        ))}
      </div>
    </>
  );
}

/** The state a tool is in (a returned one can't be new). */
export function ConditionChips({
  value,
  onChange,
  label = "Condition",
  returned,
  disabled,
}: {
  value: Condition | null;
  onChange: (c: Condition) => void;
  label?: string;
  returned?: boolean;
  disabled?: boolean;
}) {
  return (
    <>
      {label && <span className={styles.label}>{label}</span>}
      <div className={styles.chips} role="group" aria-label={label || "Condition"}>
        {CONDITIONS.filter((c) => !returned || c !== "new").map((c) => (
          <button
            key={c}
            type="button"
            className={value === c ? (needsFixing(c) ? site.chipBad : styles.chipOn) : styles.chip}
            aria-pressed={value === c}
            onClick={() => onChange(c)}
            disabled={disabled}
          >
            {CONDITION_NAMES[c]}
          </button>
        ))}
      </div>
    </>
  );
}

/** A filter row over a list: all of it, or one trade's (with how many each has). */
export function TradeFilter({ value, onChange, counts }: { value: Trade | "any"; onChange: (t: Trade | "any") => void; counts: Map<Trade, number> }) {
  if ([...counts.values()].filter((n) => n > 0).length < 2) return null;
  return (
    <div className={site.catChips} role="group" aria-label="Who uses it">
      <button type="button" className={value === "any" ? styles.chipOn : styles.chip} aria-pressed={value === "any"} onClick={() => onChange("any")}>
        All trades
      </button>
      {TRADES.filter((t) => (counts.get(t) ?? 0) > 0).map((t) => (
        <button key={t} type="button" className={value === t ? styles.chipOn : styles.chip} aria-pressed={value === t} onClick={() => onChange(value === t ? "any" : t)}>
          {TRADE_NAMES[t]} <span className={site.catCount}>{counts.get(t)}</span>
        </button>
      ))}
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

/** The units as buttons, or another one typed (a new item, something on the shopping list). */
export function UnitPicker({ value, onChange, id }: { value: string; onChange: (unit: string) => void; id: string }) {
  const custom = !(UNITS as readonly string[]).includes(value);
  return (
    <>
      <div className={styles.chips}>
        {UNITS.map((u) => (
          <button key={u} type="button" className={value === u ? styles.chipOn : styles.chip} aria-pressed={value === u} onClick={() => onChange(u)}>
            {u}
          </button>
        ))}
      </div>
      <input
        id={id}
        className={styles.input}
        value={custom ? value : ""}
        onChange={(e) => onChange(e.target.value.toLowerCase())}
        maxLength={MAX_UNIT}
        autoComplete="off"
        placeholder="Or type one, e.g. bundles"
        aria-label="Another unit"
      />
    </>
  );
}
