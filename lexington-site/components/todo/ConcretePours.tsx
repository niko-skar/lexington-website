"use client";

import { useMemo, useState } from "react";

import { estimate, ESTIMATE_KINDS, KIND_NAMES, type EstimateInput, type PourOrder } from "@/lib/concrete/estimate";
import { addDays, dayWords as pourDayWords, type PourCubes, type PourPhoto } from "@/lib/concrete/pourExtras";
import { type ConcreteData, type PourBooking, type PourInfo, type Truck } from "@/lib/concrete/shared";
import { ghanaDay } from "@/lib/store/shared";
import type { TodoMe } from "@/lib/todo/shared";
import { errorText, send, when } from "./api";
import es from "./Estimate.module.css";
import { cubesLine, PourCubesCard } from "./PourCubes";
import { EstimatePanel, estimateToSend, PourOrderSheet, startEstimate, useEstimateFloors } from "./PourEstimate";
import { PourPhotos } from "./PourPhotos";
import ps from "./Pours.module.css";
import styles from "./Todo.module.css";

// Pours booked on the concrete page (lib/concrete/pours.ts says what and why): each booked for a day with what's
// poured, the mix and m³ ordered, a checklist (a copy of one of the roll call's) and who cures it. Its checks are
// ticked here or on the roll call; the first waybill on its day marks it poured and starts its curing. Each has its
// pre-pour photos (PourPhotos.tsx); once poured, its concrete cubes' tests (PourCubes.tsx).

const ordered = (b: PourBooking) => [b.mix, b.volume ? `${b.volume} m³` : ""].filter(Boolean).join(", ");
const money = (n: number) => `GH₵ ${n.toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;
const PO_STAGE: Record<string, string> = { planned: "to order", ordered: "ordered", closed: "closed", cancelled: "cancelled" };
/** "PO-0012 · GH₵ 25,721 · to order" (the office's). */
const poWords = (po: NonNullable<PourBooking["po"]>) => `Purchase order ${po.number} · ${money(po.amount)} · ${PO_STAGE[po.status] ?? po.status}`;

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
export function BookedPours({
  info,
  me,
  onData,
  onToast,
  onOrder,
}: {
  info: PourInfo;
  me: TodoMe;
  onData: (data: ConcreteData) => void;
  onToast: (text: string, error?: boolean) => void;
  /** Opens a purchase order in Finance (the office). */
  onOrder?: (orderId: string) => void;
}) {
  const [sheet, setSheet] = useState<{ booking: PourBooking | null } | null>(null);
  const coming = info.pours.filter((b) => b.phase === "check");
  return (
    <section className={styles.group} aria-label="Pours booked">
      <h2 className={styles.groupTitle}>
        Pours booked <span>{coming.length || ""}</span>
      </h2>
      {coming.map((b) => (
        <PourCard
          key={b.id}
          booking={b}
          photos={info.photos ?? []}
          me={me}
          orderDefaults={info.orderDefaults}
          onData={onData}
          onToast={onToast}
          onChange={() => setSheet({ booking: b })}
          onOrder={onOrder}
        />
      ))}
      <button type="button" className={ps.book} onClick={() => setSheet({ booking: null })}>
        + Book a pour
      </button>
      {!coming.length && <p className={ps.hint}>Book each pour before its day: its checklist goes with it, and the first waybill that day marks it poured and starts its curing.</p>}
      {sheet && (
        <BookSheet
          info={info}
          office={me.kind === "admin"}
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

function PourCard({
  booking: b,
  photos,
  me,
  orderDefaults,
  onData,
  onToast,
  onChange,
  onOrder,
}: {
  booking: PourBooking;
  photos: PourPhoto[];
  me: TodoMe;
  orderDefaults: Partial<PourOrder> | null | undefined;
  onData: (data: ConcreteData) => void;
  onToast: (text: string, error?: boolean) => void;
  onChange: () => void;
  onOrder?: (orderId: string) => void;
}) {
  // A tick shows at once; the website catches up (and a failure puts it back).
  const [ticking, setTicking] = useState<Record<string, boolean>>({});
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ordering, setOrdering] = useState(false);
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
      {b.estimate && (
        <p className={es.worked}>
          Worked out: {b.estimate.result.parts.map((p) => `${p.label} ${p.m3.toLocaleString("en-GB", { maximumFractionDigits: 1 })} m³`).join(" + ")}
        </p>
      )}
      {b.po &&
        (onOrder ? (
          <button type="button" className={es.poLink} onClick={() => onOrder(b.po!.id)}>
            {poWords(b.po)}
          </button>
        ) : (
          <p className={es.worked}>{poWords(b.po)}</p>
        ))}
      {b.order?.sentAt && <p className={es.sent}>Order sent to {b.order.supplier || "the concrete company"} {when(b.order.sentAt)}</p>}
      <button type="button" className={es.orderButton} onClick={() => setOrdering(true)}>
        {b.order?.sentAt ? "Order on WhatsApp again" : "Order on WhatsApp"}
      </button>
      {ordering && <PourOrderSheet booking={b} defaults={orderDefaults} onClose={() => setOrdering(false)} onData={onData} onToast={onToast} />}
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
      <PourPhotos pourId={b.id} photos={photos} me={me} onData={onData} onToast={onToast} />
      <button type="button" className={left ? ps.pouredLeft : ps.poured} onClick={() => void poured()} disabled={busy}>
        {busy ? "Saving…" : !left ? "Poured: start curing" : armed ? `Tap again: poured with ${left} not checked` : `Poured by hand (${left} not checked yet)`}
      </button>
    </article>
  );
}

const noCubes = (pourId: string): PourCubes => ({ pourId, taken: null, takenAt: null, target: 35, tests: [] });

/**
 * The pours poured these last weeks, newest first: their cubes' tests (due 7, 14 and 28 days after) and their pre-pour
 * photos. A pour with a test due, or poured in the last three days, opens by itself; the others fold to one line.
 */
export function PouredPours({ info, me, onData, onToast }: { info: PourInfo; me: TodoMe; onData: (data: ConcreteData) => void; onToast: (text: string, error?: boolean) => void }) {
  const poured = info.pours.filter((b) => b.phase === "poured" && b.poured).sort((a, b) => (b.poured ?? "").localeCompare(a.poured ?? "") || a.what.localeCompare(b.what));
  if (!poured.length) return null;
  return (
    <section className={styles.group} aria-label="Poured">
      <h2 className={styles.groupTitle}>
        Poured <span>cubes and photos</span>
      </h2>
      {poured.map((b) => (
        <PouredCard key={b.id} booking={b} cubes={info.cubes?.find((c) => c.pourId === b.id) ?? noCubes(b.id)} photos={info.photos ?? []} me={me} onData={onData} onToast={onToast} />
      ))}
    </section>
  );
}

function PouredCard({
  booking: b,
  cubes,
  photos,
  me,
  onData,
  onToast,
}: {
  booking: PourBooking;
  cubes: PourCubes;
  photos: PourPhoto[];
  me: TodoMe;
  onData: (data: ConcreteData) => void;
  onToast: (text: string, error?: boolean) => void;
}) {
  const today = ghanaDay();
  const due = cubes.tests.some((t) => t.average === null && t.due && t.due <= today) || (b.poured ?? "") >= addDays(today, -3);
  const [open, setOpen] = useState(due);
  const count = photos.filter((p) => p.pourId === b.id).length;
  const words = pourDayWords(b.poured!);
  return (
    <article className={`${ps.card} ${ps.cardPoured}`} aria-label={`Poured: ${b.what}`}>
      <div className={ps.top}>
        <span className={ps.dayPoured}>Poured {words === "Today" || words === "Yesterday" ? words.toLowerCase() : words}</span>
        <button type="button" className={ps.link} onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Fold" : "Open"}
        </button>
      </div>
      <p className={ps.what}>{b.what}</p>
      {open ? (
        <>
          <PourCubesCard pour={b} cubes={cubes} onData={onData} onToast={onToast} />
          <PourPhotos pourId={b.id} photos={photos} me={me} onData={onData} onToast={onToast} />
        </>
      ) : (
        <p className={ps.line}>
          {cubesLine(cubes, today)}
          {count ? ` · ${count} ${count === 1 ? "photo" : "photos"}` : ""}
        </p>
      )}
    </article>
  );
}

function BookSheet({
  info,
  office,
  booking,
  onClose,
  onSaved,
}: {
  info: PourInfo;
  /** The office: the price of a m³ for the pour's purchase order. */
  office: boolean;
  booking: PourBooking | null;
  onClose: () => void;
  onSaved: (data: ConcreteData, text: string) => void;
}) {
  const today = ghanaDay();
  const [day, setDay] = useState(booking?.day ?? today);
  const [what, setWhat] = useState(booking?.what ?? "");
  const [checklist, setChecklist] = useState<string>(booking ? "" : (info.checklists[0]?.id ?? "none"));
  const [mix, setMix] = useState(booking?.mix ?? "");
  const [volume, setVolume] = useState(booking?.volume ? String(booking.volume) : "");
  // The pour's purchase order (9 Nov 2026): its price per m³ as on the order, else as it last cost.
  const startPrice = booking?.po && !booking.po.done ? booking.po.price : (info.concretePrice?.price ?? null);
  const [price, setPrice] = useState(startPrice ? String(startPrice) : "");
  const [curer, setCurer] = useState(booking?.curer?.id ?? info.curers.find((c) => /albert/i.test(c.name))?.id ?? info.curers[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState("");
  // The concrete worked out from the building (lib/concrete/estimate.ts): it fills "What's being poured" and the m³
  // while they're as it last filled them (or empty), so a figure typed over it stays.
  const [est, setEst] = useState<EstimateInput | null>(booking?.estimate?.input ?? null);
  const { floors, error: floorsError } = useEstimateFloors(est !== null);
  const result = useMemo(() => (est && floors ? estimate(est, floors) : null), [est, floors]);
  const [filled, setFilled] = useState<{ what: string; volume: string }>({
    what: booking?.estimate ? booking.estimate.result.what : "",
    volume: booking?.estimate ? String(booking.estimate.result.order) : "",
  });
  const [lastResult, setLastResult] = useState<typeof result>(null);
  if (result !== lastResult) {
    setLastResult(result);
    if (result && !result.problem && result.order > 0) {
      const nextWhat = what.trim() === "" || what === filled.what ? result.what : what;
      const nextVolume = volume.trim() === "" || volume === filled.volume ? String(result.order) : volume;
      if (nextWhat !== what) setWhat(nextWhat);
      if (nextVolume !== volume) setVolume(nextVolume);
      setFilled({ what: result.what, volume: String(result.order) });
    }
  }
  const pickKind = (k: EstimateInput["kind"]) => {
    if (est?.kind === k) return setEst(null);
    setEst(startEstimate(k, est, floors ?? [], what, volume));
  };
  // The building came after the kind was picked: start its parts now.
  if (est && floors && ((est.kind !== "other" && !est.columns?.floor && !est.slab?.floor) || (est.kind === "other" && !est.other))) {
    setEst(startEstimate(est.kind, null, floors, what, volume));
  }

  const priceNumber = price.trim() ? Number(price.replace(/,/g, "").trim()) : null;
  const volumeNumber = volume.trim() ? Number(volume.replace(/,/g, "").trim()) : null;
  const poTotal = priceNumber && priceNumber > 0 && volumeNumber && volumeNumber > 0 ? Math.round(priceNumber * volumeNumber * 100) / 100 : null;
  const po = booking?.po && !booking.po.done ? booking.po : null;
  const poNote = !office
    ? ""
    : poTotal
      ? `${po ? `Purchase order ${po.number} changes with it` : "A purchase order is made with it"}: ${volumeNumber} m³ × ${money(priceNumber!)} = ${money(poTotal)}${!po && info.concretePrice && priceNumber === info.concretePrice.price ? ` (${info.concretePrice.from})` : ""}.`
      : `Type the m³ ordered and the price of a m³: a purchase order is made with it.`;

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
    if (est && result?.problem) return setError(`${result.problem} (Or tap ${KIND_NAMES[est.kind]} again to book it without working it out.)`);
    if (est && !result) return setError("Still getting the building's measurements: try again in a moment.");
    if (office && price.trim() && !(priceNumber && priceNumber > 0)) return setError("Type the price of a m³ in GH₵, e.g. 1513.");
    const estimateField = est ? { estimate: estimateToSend(est) } : booking?.estimate ? { estimate: null } : {};
    const fields = { day, what: what.trim(), mix: mix.trim(), volume: volume.trim(), curer, ...estimateField, ...(office && priceNumber ? { price: priceNumber } : {}) };
    void (booking ? run({ action: "change", id: booking.id, ...fields }, "Pour changed") : run({ action: "book", ...fields, checklist }, `Booked: ${what.trim()}, ${pourDayWords(day).toLowerCase()}`));
  };

  return (
    <div className={styles.sheetBackdrop}>
      <div className={est ? `${styles.sheet} ${es.sheetWide}` : styles.sheet} role="dialog" aria-label={booking ? "Change the pour" : "Book a pour"}>
        <h2 className={styles.sheetTitle}>{booking ? "Change the pour" : "Book a pour"}</h2>
        <label className={styles.label} htmlFor="bp-day">
          Day of the pour
        </label>
        <input id="bp-day" className={styles.input} type="date" value={day} min={addDays(today, -14)} max={addDays(today, 120)} onChange={(e) => e.target.value && setDay(e.target.value)} disabled={saving} />
        <label className={styles.label} htmlFor="bp-what">
          What&rsquo;s being poured
        </label>
        <input id="bp-what" className={styles.input} value={what} onChange={(e) => setWhat(e.target.value)} maxLength={80} placeholder="e.g. 1st floor slab" disabled={saving} />
        <span className={styles.label}>Work out the m³ from the building</span>
        <div className={styles.chips} role="group" aria-label="Work out the m³">
          {ESTIMATE_KINDS.map((k) => (
            <button key={k} type="button" className={est?.kind === k ? styles.chipOn : styles.chip} aria-pressed={est?.kind === k} onClick={() => pickKind(k)} disabled={saving}>
              {KIND_NAMES[k]}
            </button>
          ))}
        </div>
        {est && <EstimatePanel floors={floors} error={floorsError} value={est} onChange={setEst} result={result} disabled={saving} />}
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
        {office && (
          <>
            <label className={styles.label} htmlFor="bp-price">
              Price of a m³ (GH₵)
            </label>
            <input id="bp-price" className={styles.input} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 1513" disabled={saving} />
            <p className={styles.sheetNote} aria-live="polite">
              {poNote}
            </p>
          </>
        )}
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
