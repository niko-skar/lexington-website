"use client";

import { useState } from "react";

import { type ConcreteData, type PourBooking, type PourInfo, type Truck } from "@/lib/concrete/shared";
import { ghanaDay } from "@/lib/store/shared";
import { errorText, send } from "./api";
import ps from "./Pours.module.css";
import styles from "./Todo.module.css";

// Pours booked on the concrete page (lib/concrete/pours.ts says what and why): each booked for a day with what's
// poured, the mix and m³ ordered, a checklist (a copy of one of the roll call's) and who cures it. Its checks are
// ticked here or on the roll call; the first waybill on its day marks it poured and starts its curing.

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const pourDayWords = (day: string) => {
  const today = ghanaDay();
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  if (day === addDays(today, -1)) return "Yesterday";
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
};
const ordered = (b: PourBooking) => [b.mix, b.volume ? `${b.volume} m³` : ""].filter(Boolean).join(", ");

/** What the day's bookings came to, under the day's heading: poured and curing, or still waiting. */
export function pourStatus(b: PourBooking): string {
  if (b.phase === "poured" && b.poured) {
    const last = b.curingDays ? addDays(b.poured, b.curingDays - 1) : null;
    return `${b.what}: poured, curing${b.curingDays ? ` ${b.curingDays} days, to ${pourDayWords(last!)}` : ""}${b.curer ? ` (${b.curer.name})` : ""}`;
  }
  const done = b.checks.filter((c) => c.ok).length;
  return `${b.what}: booked${b.checks.length ? `, ${done} of ${b.checks.length} checks` : ""}; its first truck marks it poured`;
}

/** The pours booked and not poured yet, soonest first, each with its checklist. */
export function BookedPours({ info, onData, onToast }: { info: PourInfo; onData: (data: ConcreteData) => void; onToast: (text: string, error?: boolean) => void }) {
  const [sheet, setSheet] = useState<{ booking: PourBooking | null } | null>(null);
  const coming = info.pours.filter((b) => b.phase === "check");
  return (
    <section className={styles.group} aria-label="Pours booked">
      <h2 className={styles.groupTitle}>
        Pours booked <span>{coming.length || ""}</span>
      </h2>
      {coming.map((b) => (
        <PourCard key={b.id} booking={b} onData={onData} onToast={onToast} onChange={() => setSheet({ booking: b })} />
      ))}
      <button type="button" className={ps.book} onClick={() => setSheet({ booking: null })}>
        + Book a pour
      </button>
      {!coming.length && <p className={ps.hint}>Book each pour before its day: its checklist goes with it, and the first waybill that day marks it poured and starts its curing.</p>}
      {sheet && (
        <BookSheet
          info={info}
          booking={sheet.booking}
          onClose={() => setSheet(null)}
          onSaved={(data, text) => {
            onData(data);
            setSheet(null);
            onToast(text);
          }}
        />
      )}
    </section>
  );
}

function PourCard({ booking: b, onData, onToast, onChange }: { booking: PourBooking; onData: (data: ConcreteData) => void; onToast: (text: string, error?: boolean) => void; onChange: () => void }) {
  // A tick shows at once; the website catches up (and a failure puts it back).
  const [ticking, setTicking] = useState<Record<string, boolean>>({});
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const checks = b.checks.map((c) => (c.key in ticking ? { ...c, ok: ticking[c.key] } : c));
  const left = checks.filter((c) => !c.ok).length;

  const tick = async (key: string, ok: boolean) => {
    setTicking((t) => ({ ...t, [key]: ok }));
    try {
      onData(await send<ConcreteData>("/api/concrete/pours", "POST", { action: "tick", id: b.id, key, ok }));
    } catch (e) {
      onToast(errorText(e), true);
    } finally {
      setTicking((t) => {
        const next = { ...t };
        delete next[key];
        return next;
      });
    }
  };

  const poured = async () => {
    if (left && !armed) return setArmed(true);
    setBusy(true);
    try {
      onData(await send<ConcreteData>("/api/concrete/pours", "POST", { action: "poured", id: b.id }));
      onToast(`Poured: ${b.what}. Its curing starts ${pourDayWords(b.day).toLowerCase()}.`);
    } catch (e) {
      onToast(errorText(e), true);
    } finally {
      setBusy(false);
      setArmed(false);
    }
  };

  return (
    <article className={ps.card} aria-label={`Pour: ${b.what}`}>
      <div className={ps.top}>
        <span className={ps.day}>{pourDayWords(b.day)}</span>
        <button type="button" className={ps.link} onClick={onChange}>
          Change
        </button>
      </div>
      <p className={ps.what}>{b.what}</p>
      <p className={ps.line}>
        {[ordered(b) ? `Ordered ${ordered(b)}` : "", b.curer ? `cured by ${b.curer.name}` : ""].filter(Boolean).join(" · ")}
      </p>
      {checks.length > 0 && (
        <>
          <p className={ps.progress}>
            {b.checklist ?? "Checklist"}: {checks.length - left} of {checks.length} checked
          </p>
          <ul className={ps.checks}>
            {checks.map((c) => (
              <li key={c.key}>
                <button type="button" className={c.ok ? ps.checkOn : ps.check} aria-pressed={c.ok} onClick={() => void tick(c.key, !c.ok)}>
                  <span className={ps.box} aria-hidden="true">
                    ✓
                  </span>
                  <span>{c.text}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <button type="button" className={left ? ps.pouredLeft : ps.poured} onClick={() => void poured()} disabled={busy}>
        {busy ? "Saving…" : !left ? "Poured: start curing" : armed ? `Tap again: poured with ${left} not checked` : `Poured by hand (${left} not checked yet)`}
      </button>
    </article>
  );
}

function BookSheet({ info, booking, onClose, onSaved }: { info: PourInfo; booking: PourBooking | null; onClose: () => void; onSaved: (data: ConcreteData, text: string) => void }) {
  const today = ghanaDay();
  const [day, setDay] = useState(booking?.day ?? today);
  const [what, setWhat] = useState(booking?.what ?? "");
  const [checklist, setChecklist] = useState<string>(booking ? "" : (info.checklists[0]?.id ?? "none"));
  const [mix, setMix] = useState(booking?.mix ?? "");
  const [volume, setVolume] = useState(booking?.volume ? String(booking.volume) : "");
  const [curer, setCurer] = useState(booking?.curer?.id ?? info.curers.find((c) => /albert/i.test(c.name))?.id ?? info.curers[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState("");

  const run = async (body: Record<string, unknown>, text: string) => {
    setSaving(true);
    setError("");
    try {
      onSaved(await send<ConcreteData>("/api/concrete/pours", "POST", body), text);
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };
  const save = () => {
    if (!what.trim()) return setError("Say what's being poured, e.g. 1st floor slab.");
    const fields = { day, what: what.trim(), mix: mix.trim(), volume: volume.trim(), curer };
    void (booking ? run({ action: "change", id: booking.id, ...fields }, "Pour changed") : run({ action: "book", ...fields, checklist }, `Booked: ${what.trim()}, ${pourDayWords(day).toLowerCase()}`));
  };

  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label={booking ? "Change the pour" : "Book a pour"}>
        <h2 className={styles.sheetTitle}>{booking ? "Change the pour" : "Book a pour"}</h2>
        <label className={styles.label} htmlFor="bp-day">
          Day of the pour
        </label>
        <input id="bp-day" className={styles.input} type="date" value={day} min={addDays(today, -14)} max={addDays(today, 120)} onChange={(e) => e.target.value && setDay(e.target.value)} disabled={saving} />
        <label className={styles.label} htmlFor="bp-what">
          What&rsquo;s being poured
        </label>
        <input id="bp-what" className={styles.input} value={what} onChange={(e) => setWhat(e.target.value)} maxLength={80} placeholder="e.g. 1st floor slab" disabled={saving} />
        {!booking && (
          <>
            <span className={styles.label}>Checklist before the pour</span>
            <div className={styles.chips}>
              {[...info.checklists, { id: "none", name: "No checklist" }].map((c) => (
                <button key={c.id} type="button" className={checklist === c.id ? styles.chipOn : styles.chip} aria-pressed={checklist === c.id} onClick={() => setChecklist(c.id)} disabled={saving}>
                  {c.name}
                </button>
              ))}
            </div>
          </>
        )}
        <div className={ps.grid2}>
          <label className={styles.label}>
            Mix ordered
            <input className={styles.input} value={mix} onChange={(e) => setMix(e.target.value)} maxLength={30} placeholder="e.g. 25 MPa" disabled={saving} />
          </label>
          <label className={styles.label}>
            m³ ordered
            <input className={styles.input} inputMode="decimal" value={volume} onChange={(e) => setVolume(e.target.value)} placeholder="e.g. 24" disabled={saving} />
          </label>
        </div>
        {info.curers.length > 0 && (
          <>
            <label className={styles.label} htmlFor="bp-curer">
              Who cures it
            </label>
            <select id="bp-curer" className={styles.input} value={curer} onChange={(e) => setCurer(e.target.value)} disabled={saving}>
              {info.curers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </>
        )}
        <p className={styles.sheetNote}>
          The first waybill on that day marks it poured: its curing starts then, {info.curingDays} days, on the roll call and Payday.
        </p>
        {error && (
          <p className={styles.sheetError} role="alert">
            {error}
          </p>
        )}
        {booking && (
          <button
            type="button"
            className={armed ? `${ps.delete} ${styles.dangerArmed}` : ps.delete}
            onClick={() => (armed ? void run({ action: "delete", id: booking.id }, "Pour taken off") : setArmed(true))}
            disabled={saving}
          >
            {armed ? "Tap again to take this pour off" : "Take this pour off"}
          </button>
        )}
        <div className={styles.sheetButtons}>
          <button type="button" className={styles.sheetCancel} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className={styles.sheetSave} onClick={save} disabled={saving}>
            {saving ? "Saving…" : booking ? "Save" : "Book it"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** On a truck's sheet when two pours are booked that day: which one it brought (that one is poured). */
export function TruckPour({ truck, bookings, onPick, busy }: { truck: Truck; bookings: PourBooking[]; onPick: (id: string) => void; busy: boolean }) {
  if (!bookings.length) return null;
  const mine = bookings.find((b) => b.id === truck.pourId);
  if (bookings.length === 1 || mine) {
    const b = mine ?? bookings[0];
    return (
      <p className={ps.truckFor}>
        For: <b>{b.what}</b>
        {b.phase === "poured" && b.poured ? `, poured: curing from ${b.poured === ghanaDay() ? "today" : pourDayWords(b.poured)}` : ""}
      </p>
    );
  }
  return (
    <div className={ps.truckPick}>
      <span className={styles.label}>Which pour did it bring?</span>
      <div className={styles.chips}>
        {bookings.map((b) => (
          <button key={b.id} type="button" className={styles.chip} onClick={() => onPick(b.id)} disabled={busy}>
            {b.what}
          </button>
        ))}
      </div>
    </div>
  );
}
