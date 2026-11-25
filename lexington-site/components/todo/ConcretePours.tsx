"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import { estimate, ESTIMATE_KINDS, KIND_NAMES, type EstimateInput, type PourOrder } from "@/lib/concrete/estimate";
import { addDays, dayWords as pourDayWords, isDue, UNDO_POURED_DAYS, type PourCubes, type PourPhoto } from "@/lib/concrete/pourExtras";
import { cubic, delivered, shortDate, type ConcreteData, type PourBooking, type PourDay, type PourInfo, type Truck } from "@/lib/concrete/shared";
import { ghanaDay } from "@/lib/store/shared";
import type { TodoMe } from "@/lib/todo/shared";
import { errorText, send, when } from "./api";
import cx from "./Concrete.module.css";
import { DayLine, plural, TruckList, trucksWords } from "./ConcreteTrucks";
import es from "./Estimate.module.css";
import { cubesLine, PourCubesCard } from "./PourCubes";
import { EstimatePanel, estimateToSend, PourOrderSheet, startEstimate, useEstimateFloors } from "./PourEstimate";
import { PourPhotos } from "./PourPhotos";
import ps from "./Pours.module.css";
import styles from "./Todo.module.css";

// A pour on the concrete page, all in one card (Niko, 25 Nov 2026: "concrete is disjointed, one pour is on top and then
// the photos of the waybills for the truck is at the bottom. put them together and make it easy to fold or hide all
// the information about that pour"). Booked (lib/concrete/pours.ts): what's poured, the order, its checklist and its
// pre-pour photos (PourPhotos.tsx); the first waybill on its day marks it poured. Poured: its trucks with their
// waybills, its curing, its concrete cubes' tests (PourCubes.tsx), how the checks stood and its photos. The title folds
// it to a line; the card keeps it folded or open on this phone until tapped again.

const ordered = (b: PourBooking) => [b.mix, b.volume ? `${b.volume} m³` : ""].filter(Boolean).join(", ");
const money = (n: number) => `GH₵ ${n.toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;
const PO_STAGE: Record<string, string> = { planned: "to order", ordered: "ordered", closed: "closed", cancelled: "cancelled" };
/** "PO-0012 · GH₵ 25,721 · to order" (the office's). */
const poWords = (po: NonNullable<PourBooking["po"]>) => `Purchase order ${po.number} · ${money(po.amount)} · ${PO_STAGE[po.status] ?? po.status}`;
const m3 = (v: number) => v.toLocaleString("en-GB", { maximumFractionDigits: 1 });

/* ---------- which cards are folded, kept on this phone ---------- */

const FOLDS = "lexington-concrete-open";
const KEEP_FOLDS = 80;
let folds: string | null = null;
const foldWatchers = new Set<() => void>();
const readFolds = () => {
  if (folds === null) {
    try {
      folds = localStorage.getItem(FOLDS) ?? "{}";
    } catch {
      folds = "{}";
    }
  }
  return folds;
};
const watchFolds = (fn: () => void) => {
  foldWatchers.add(fn);
  return () => {
    foldWatchers.delete(fn);
  };
};

/** Each card's open or folded, as last tapped on this phone (a card never tapped opens as it should by itself). */
export function useFolds(): [Record<string, boolean>, (key: string, open: boolean) => void] {
  const raw = useSyncExternalStore(watchFolds, readFolds, () => "{}");
  const map = useMemo<Record<string, boolean>>(() => {
    try {
      return JSON.parse(raw) as Record<string, boolean>;
    } catch {
      return {};
    }
  }, [raw]);
  const setFold = useCallback((key: string, open: boolean) => {
    let now: Record<string, boolean> = {};
    try {
      now = JSON.parse(readFolds()) as Record<string, boolean>;
    } catch {
      now = {};
    }
    delete now[key];
    now[key] = open;
    folds = JSON.stringify(Object.fromEntries(Object.entries(now).slice(-KEEP_FOLDS)));
    try {
      localStorage.setItem(FOLDS, folds);
    } catch {
      // A private window: it's kept while the page is open.
    }
    foldWatchers.forEach((fn) => fn());
  }, []);
  return [map, setFold];
}

/**
 * A card that hasn't been tapped: a pour booked is open (its checklist is ticked in the days before it); a poured one
 * while it matters now (poured today or yesterday, a cube test due or late).
 */
export function opensByItself(b: PourBooking, cubes: PourCubes | undefined, today = ghanaDay()): boolean {
  if (b.phase === "check") return true;
  return (b.poured ?? "") >= addDays(today, -1) || !!cubes?.tests.some((t) => isDue(t, today));
}

/* ---------- a pour's card ---------- */

/** While it cures: "curing to Mon 30 Nov" (once it's cured, nothing). */
function curingWords(b: PourBooking, today: string): string {
  if (!b.poured || !b.curingDays) return "";
  const last = addDays(b.poured, b.curingDays - 1);
  return last >= today ? `curing to ${pourDayWords(last)}` : "";
}

export function PourCard({
  booking: b,
  trucks,
  all,
  day,
  cubes,
  photos,
  me,
  orderDefaults,
  fold,
  onFold,
  onData,
  onToast,
  onChange,
  onOrder,
  onTruck,
}: {
  booking: PourBooking;
  /** The trucks that brought it, in the order they came. */
  trucks: Truck[];
  /** Every truck on the page (a truck's checks compare it with the others). */
  all: Truck[];
  /** Its day's record: the mix ordered, for the trucks' checks. */
  day: PourDay | null;
  cubes: PourCubes;
  photos: PourPhoto[];
  me: TodoMe;
  orderDefaults: Partial<PourOrder> | null | undefined;
  /** Open or folded as last tapped on this phone; never tapped: as it opened by itself. */
  fold: boolean | undefined;
  onFold: (open: boolean) => void;
  onData: (data: ConcreteData) => void;
  onToast: (text: string, error?: boolean) => void;
  onChange: () => void;
  /** Opens a purchase order in Finance (the office). */
  onOrder?: (orderId: string) => void;
  onTruck: (id: string) => void;
}) {
  // Whether it opens by itself is settled when the card first shows: a cube result typed in, or the day turning over,
  // never folds it while it's being worked on.
  const [auto] = useState(() => opensByItself(b, cubes));
  const open = fold ?? auto;
  const today = ghanaDay();
  const booked = b.phase !== "poured" || !b.poured;
  const count = photos.filter((p) => p.pourId === b.id).length;
  const done = b.checks.filter((c) => c.ok).length;
  // Its cubes in a line ("7 days 31.2 MPa ✓ · 14 days due Fri 7 Nov"), red while a test is due or late.
  const cube = booked ? null : { text: cubesLine(cubes, today), late: cubes.tests.some((t) => isDue(t, today)) };
  const words = pourDayWords(booked ? b.day : b.poured!);
  const label = booked
    ? `${words}${b.day < today ? " · not marked poured" : ""}`
    : `Poured ${words === "Today" || words === "Yesterday" ? words.toLowerCase() : words}`;
  const summary = booked
    ? [
        ordered(b) ? `Ordered ${ordered(b)}` : "",
        b.checks.length ? `${done} of ${b.checks.length} checked` : "",
        count ? plural(count, "photo") : "",
        b.order?.sentAt ? "order sent" : "",
      ]
    : [trucks.length ? trucksWords(trucks) : "poured by hand", curingWords(b, today)];
  const after = !booked && count ? plural(count, "photo") : "";
  return (
    <article className={`${ps.card} ${booked ? "" : ps.cardPoured}`} aria-label={`${booked ? "Pour" : "Poured"}: ${b.what}`}>
      <div className={ps.top}>
        <span className={booked ? ps.day : ps.dayPoured}>{label}</span>
        {booked && (
          <button type="button" className={ps.link} onClick={onChange}>
            Change
          </button>
        )}
      </div>
      <button type="button" className={ps.fold} aria-expanded={open} onClick={() => onFold(!open)}>
        <span className={ps.foldText}>
          <span className={ps.what}>{b.what}</span>
          <span className={ps.sum}>
            {summary.filter(Boolean).join(" · ")}
            {cube ? (
              <>
                {" · "}
                <span className={cube.late ? ps.sumLate : undefined}>{cube.text}</span>
              </>
            ) : null}
            {after ? ` · ${after}` : ""}
          </span>
        </span>
        <span className={ps.chev}>{open ? "Fold" : "Open"}</span>
      </button>
      {open &&
        (booked ? (
          <BookedBody booking={b} photos={photos} me={me} orderDefaults={orderDefaults} onData={onData} onToast={onToast} onOrder={onOrder} />
        ) : (
          <PouredBody booking={b} trucks={trucks} all={all} day={day} cubes={cubes} photos={photos} me={me} onData={onData} onToast={onToast} onOrder={onOrder} onTruck={onTruck} />
        ))}
    </article>
  );
}

/** What was ordered and worked out, the purchase order, the order sent (both kinds of card). */
function OrderLines({ booking: b, onOrder }: { booking: PourBooking; onOrder?: (orderId: string) => void }) {
  return (
    <>
      <p className={ps.line}>{[ordered(b) ? `Ordered ${ordered(b)}` : "Nothing ordered yet", b.curer ? `cured by ${b.curer.name}` : ""].filter(Boolean).join(" · ")}</p>
      {b.estimate && <p className={es.worked}>Worked out: {b.estimate.result.parts.map((p) => `${p.label} ${m3(p.m3)} m³`).join(" + ")}</p>}
      {b.po &&
        (onOrder ? (
          <button type="button" className={es.poLink} onClick={() => onOrder(b.po!.id)}>
            {poWords(b.po)}
          </button>
        ) : (
          <p className={es.worked}>{poWords(b.po)}</p>
        ))}
      {b.order?.sentAt && <p className={es.sent}>Order sent to {b.order.supplier || "the concrete company"} {when(b.order.sentAt)}</p>}
    </>
  );
}

function BookedBody({
  booking: b,
  photos,
  me,
  orderDefaults,
  onData,
  onToast,
  onOrder,
}: {
  booking: PourBooking;
  photos: PourPhoto[];
  me: TodoMe;
  orderDefaults: Partial<PourOrder> | null | undefined;
  onData: (data: ConcreteData) => void;
  onToast: (text: string, error?: boolean) => void;
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
    <>
      <OrderLines booking={b} onOrder={onOrder} />
      <button type="button" className={es.orderButton} onClick={() => setOrdering(true)}>
        {b.order?.sentAt ? "Order on WhatsApp again" : "Order on WhatsApp"}
      </button>
      {ordering && <PourOrderSheet booking={b} defaults={orderDefaults} onClose={() => setOrdering(false)} onData={onData} onToast={onToast} />}
      {checks.length > 0 && (
        <div className={ps.part}>
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
        </div>
      )}
      <PourPhotos pourId={b.id} photos={photos} me={me} onData={onData} onToast={onToast} />
      <div className={ps.part}>
        <p className={ps.progress}>Trucks</p>
        <p className={ps.line}>
          {b.day === ghanaDay()
            ? "None yet. When one arrives, tap Truck arrived at the top and photo its waybill: the first one marks this pour poured and starts its curing."
            : `The first waybill on ${pourDayWords(b.day).toLowerCase() === "tomorrow" ? "tomorrow" : shortDate(b.day)} marks this pour poured and starts its curing.`}
        </p>
      </div>
      <button type="button" className={left ? ps.pouredLeft : ps.poured} onClick={() => void poured()} disabled={busy}>
        {busy ? "Saving…" : !left ? "Poured: start curing" : armed ? `Tap again: poured with ${left} not checked` : `Poured by hand (${left} not checked yet)`}
      </button>
    </>
  );
}

function PouredBody({
  booking: b,
  trucks,
  all,
  day,
  cubes,
  photos,
  me,
  onData,
  onToast,
  onOrder,
  onTruck,
}: {
  booking: PourBooking;
  trucks: Truck[];
  all: Truck[];
  day: PourDay | null;
  cubes: PourCubes;
  photos: PourPhoto[];
  me: TodoMe;
  onData: (data: ConcreteData) => void;
  onToast: (text: string, error?: boolean) => void;
  onOrder?: (orderId: string) => void;
  onTruck: (id: string) => void;
}) {
  const today = ghanaDay();
  const [showChecks, setShowChecks] = useState(false);
  const done = b.checks.filter((c) => c.ok).length;
  const last = b.curingDays ? addDays(b.poured!, b.curingDays - 1) : null;
  // "Poured" tapped by mistake (Niko, 16 Nov 2026): back to booked, while nothing says it really was poured (no
  // truck, no cubes) and it's within three days (lib/concrete/pours.ts pourUndone checks the same).
  const canUndo = !trucks.length && !(cubes.taken ?? 0) && !cubes.tests.some((t) => t.average !== null || t.form) && (b.poured ?? "") >= addDays(today, -UNDO_POURED_DAYS);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const undo = async () => {
    if (!armed) return setArmed(true);
    setBusy(true);
    try {
      onData(await send<ConcreteData>("/api/concrete/pours", "POST", { action: "notPoured", id: b.id }));
      onToast(`Not poured: ${b.what} is back with the pours booked.`);
    } catch (e) {
      onToast(errorText(e), true);
    } finally {
      setBusy(false);
      setArmed(false);
    }
  };
  return (
    <>
      <div className={ps.part}>
        <p className={ps.progress}>Trucks</p>
        {trucks.length ? (
          <TruckList trucks={trucks} all={all} day={day} ordered={b.volume} worked={b.estimate?.result.m3 ?? null} going={b.poured === today} onOpen={onTruck} />
        ) : (
          <p className={ps.line}>Marked poured by hand: no waybills here.</p>
        )}
      </div>
      {last && (
        <p className={ps.line}>
          {last >= today ? `Curing ${b.curingDays} days, to ${pourDayWords(last)}` : `Cured ${b.curingDays} days, to ${pourDayWords(last)}`}
          {b.curer ? ` (${b.curer.name})` : ""}
        </p>
      )}
      <PourCubesCard pour={b} cubes={cubes} onData={onData} onToast={onToast} />
      {b.checks.length > 0 && (
        <div className={ps.part}>
          <div className={ps.top}>
            <p className={ps.progress}>
              {b.checklist ?? "Checklist"}: {done} of {b.checks.length} checked{done === b.checks.length ? " ✓" : ""}
            </p>
            <button type="button" className={ps.link} onClick={() => setShowChecks(!showChecks)} aria-expanded={showChecks}>
              {showChecks ? "Hide" : "Show"}
            </button>
          </div>
          {showChecks && (
            <ul className={ps.checks}>
              {b.checks.map((c) => (
                <li key={c.key} className={c.ok ? ps.checkOn : ps.check}>
                  <span className={ps.box} aria-hidden="true">
                    {c.ok ? "✓" : "–"}
                  </span>
                  <span>
                    {c.text}
                    <small className={ps.checkWhen}>{c.ok ? (c.at ? `Checked ${when(c.at)}` : "Checked") : "Not checked"}</small>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <PourPhotos pourId={b.id} photos={photos} me={me} onData={onData} onToast={onToast} />
      {(b.volume || b.estimate || b.po || b.order?.sentAt) && (
        <div className={ps.part}>
          <p className={ps.progress}>The order</p>
          <OrderLines booking={b} onOrder={onOrder} />
        </div>
      )}
      {canUndo && (
        <button type="button" className={armed ? `${ps.pouredLeft} ${styles.dangerArmed}` : ps.pouredLeft} onClick={() => void undo()} disabled={busy}>
          {busy ? "Saving…" : armed ? "Tap again: not poured, back to booked" : "Not poured? Undo"}
        </button>
      )}
    </>
  );
}

/* ---------- a day's trucks with no pour to go with ---------- */

/**
 * Trucks no listed pour has: on a day with nothing booked (or before pours were booked here), or two pours booked that
 * day and nobody has said which one a truck brought yet.
 */
export function DayCard({
  day,
  trucks,
  all,
  record,
  booked,
  fold,
  onFold,
  onTruck,
  onDay,
}: {
  day: string;
  trucks: Truck[];
  all: Truck[];
  record: PourDay | null;
  /** Pours booked that day: two or more, and the trucks wait to be told which one they brought. */
  booked: number;
  /** Open or folded as last tapped on this phone; never tapped: open on its own day. */
  fold: boolean | undefined;
  onFold: (open: boolean) => void;
  onTruck: (id: string) => void;
  onDay: () => void;
}) {
  const [auto] = useState(() => day === ghanaDay());
  const open = fold ?? auto;
  const today = ghanaDay();
  const words = pourDayWords(day);
  return (
    <article className={`${ps.card} ${ps.cardDay}`} aria-label={`Trucks: ${shortDate(day)}`}>
      <div className={ps.top}>
        <span className={ps.dayMuted}>{words}</span>
      </div>
      <button type="button" className={ps.fold} aria-expanded={open} onClick={() => onFold(!open)}>
        <span className={ps.foldText}>
          <span className={ps.what}>{record?.pour || "Concrete trucks"}</span>
          <span className={ps.sum}>
            {trucksWords(trucks)}
            {booked > 1 ? " · which pour?" : ""}
          </span>
        </span>
        <span className={ps.chev}>{open ? "Fold" : "Open"}</span>
      </button>
      {open && (
        <>
          {booked > 1 ? (
            <p className={cx.flagCheck}>{booked} pours are booked that day: tap each truck to say which one it brought.</p>
          ) : (
            <DayLine pour={record} trucks={trucks} onEdit={onDay} />
          )}
          {/* The day's line says what came of what was ordered: the list doesn't say it again. */}
          <TruckList trucks={trucks} all={all} day={record} ordered={booked > 1 ? (record?.volume ?? null) : null} worked={null} going={day === today} onOpen={onTruck} />
        </>
      )}
    </article>
  );
}

/* ---------- booking a pour ---------- */

/**
 * The last pour that was worked out and came in by truck: what the drawings said against what came (24 Nov 2026: the
 * 3rd floor slab worked out at 59.5 m³ and took about 70), said where the next one is worked out.
 */
export function lastPourWords(pours: readonly PourBooking[], byPour: ReadonlyMap<string, Truck[]>): string | null {
  const today = ghanaDay();
  const done = pours
    .filter((b) => b.phase === "poured" && b.poured && b.poured < today && (b.estimate?.result.m3 ?? 0) > 0 && (byPour.get(b.id)?.length ?? 0) > 0)
    .sort((a, b) => (b.poured ?? "").localeCompare(a.poured ?? ""));
  for (const b of done) {
    const got = delivered(byPour.get(b.id)!);
    const came = got.missing && got.usual !== null ? got.likely : got.known;
    if (!(came > 0)) continue;
    const worked = b.estimate!.result.m3;
    const pct = Math.round((came / worked - 1) * 100);
    const how = Math.abs(pct) < 3 ? "about what it worked out at" : `${Math.abs(pct)}% ${pct > 0 ? "more" : "less"}`;
    return `Last pour, ${b.what} on ${shortDate(b.poured!)}: worked out at ${m3(worked)} m³, ${got.missing ? "about " : ""}${cubic(came)} m³ came (${how}).`;
  }
  return null;
}

export function BookSheet({
  info,
  office,
  booking,
  lastPour,
  onClose,
  onSaved,
}: {
  info: PourInfo;
  /** The office: the price of a m³ for the pour's purchase order. */
  office: boolean;
  booking: PourBooking | null;
  /** What the last pour worked out at against what came (lastPourWords). */
  lastPour: string | null;
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
        {est && <EstimatePanel floors={floors} error={floorsError} value={est} onChange={setEst} result={result} disabled={saving} lastPour={lastPour} />}
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
