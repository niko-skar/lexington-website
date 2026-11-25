"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { PourCubes } from "@/lib/concrete/pourExtras";
import {
  clockOf,
  MAX_COMMENT,
  MAX_FIELD,
  roadMinutes,
  ROAD_MAX_MIN,
  ROAD_USUAL_MIN,
  shortDate,
  tidyTime,
  truckFlags,
  trucksByPour,
  trucksOn,
  type ArrivedFrom,
  type ConcreteData,
  type PourBooking,
  type PourDay,
  type PourInfo,
  type Truck,
} from "@/lib/concrete/shared";
import { ghanaDay } from "@/lib/store/shared";
import { photoAt, type TodoMe } from "@/lib/todo/shared";
import { AccessSheet } from "./AccessSheet";
import { errorText, send, startPolling } from "./api";
import cx from "./Concrete.module.css";
import { BookSheet, DayCard, lastPourWords, PourCard, TruckPour, useFolds } from "./ConcretePours";
import { Flags, trucksWords } from "./ConcreteTrucks";
import { forgetPhoto, uploadPhoto } from "./photo";
import { arrivalOf } from "./photoTime";
import { PourChecklists } from "./PourChecklists";
import { setPourDataSink } from "./pourPhotoQueue";
import ps from "./Pours.module.css";
import { SiteHeader, SiteMenu } from "./SiteChrome";
import styles from "./Todo.module.css";

// The concrete page (lib/concrete/shared.ts says what and why). "Truck arrived" opens the camera: the photo of the
// waybill makes the truck at once, timed by the photo, and its sheet opens while Claude reads the waybill; the slump,
// cubes and a comment go in when the tests are done. Since 25 Nov 2026 each pour is one card with everything about it
// (ConcretePours.tsx): booked with its checklist and pre-pour photos, then its trucks as they come in (how long each
// took from the yard, anything that doesn't add up), its curing and its cubes. Today's pour comes first, then the
// pours booked, then the ones poured; the pour checklists are at the bottom (they were on the roll call's Workers).

type ToastData = { text: string; tone?: "error" };
/** A waybill photo on its way: uploading, then making the truck; kept with its time if the signal drops. */
type Pending = { key: number; file: File; preview: string; at: string; from: ArrivedFrom; photoId?: string; state: "sending" | "error"; error?: string };

const CAMERA = "concrete-camera";
const GALLERY = "concrete-gallery";
const FROM_WORDS: Record<ArrivedFrom, string> = {
  photo: "the time the photo was taken",
  file: "the photo file's time",
  now: "when the photo was added",
  typed: "typed in",
};

const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
const dayTitle = (day: string) => {
  const today = ghanaDay();
  if (day === today) return `Today, ${shortDate(day)}`;
  if (day === ghanaDay(Date.now() - 86_400_000)) return `Yesterday, ${shortDate(day)}`;
  return longDay(day);
};
const sortTrucks = (list: Truck[]) => [...list].sort((a, b) => b.arrivedAt.localeCompare(a.arrivedAt));
const noCubes = (pourId: string): PourCubes => ({ pourId, taken: null, takenAt: null, target: 35, tests: [] });
/** A card on the page: a pour (booked or poured), or a day's trucks no listed pour has. */
type Card = { key: string; date: string; booking?: PourBooking; day?: string; trucks: Truck[] };

export function ConcreteApp({
  me,
  active,
  initial,
  openTruck,
  startedOffline,
  fresh,
  onOrder,
}: {
  me: TodoMe;
  active: boolean;
  /** Null when the app opened on another part and the trucks haven't arrived yet. */
  initial: ConcreteData | null;
  /** Opened from a phone alert about a truck: that truck's sheet opens. */
  openTruck?: string;
  startedOffline: boolean;
  fresh: boolean;
  /** A pour's purchase order opened in Finance (the office). */
  onOrder?: (orderId: string) => void;
}) {
  const [data, setData] = useState<ConcreteData>(initial ?? { trucks: [], days: [] });
  const [loaded, setLoaded] = useState(initial !== null);
  const [offline, setOffline] = useState(startedOffline);
  const [signedOut, setSignedOut] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dayOpen, setDayOpen] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const localAt = useRef(0);
  const inFlight = useRef(false);
  const lastServer = useRef("");
  const lastLoadedAt = useRef(0);
  const skipFirst = useRef(fresh);
  const counter = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showToast = useCallback((t: ToastData) => {
    clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const startedAt = Date.now();
    try {
      const response = await fetch("/api/concrete", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        setSignedOut(true);
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      const text = await response.text();
      lastLoadedAt.current = Date.now();
      setLoaded(true);
      setOffline(false);
      if (text === lastServer.current || startedAt < localAt.current) return;
      lastServer.current = text;
      setData(JSON.parse(text) as ConcreteData);
    } catch {
      setOffline(true);
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    if (skipFirst.current) skipFirst.current = false;
    else if (Date.now() - lastLoadedAt.current > 4_000) void refresh();
    return startPolling(refresh, 20_000, 120_000);
  }, [active, refresh]);

  // While a waybill or a lab's cube form is being read: look every few seconds, so what it says appears as soon as it's in.
  const reading = data.trucks.some((t) => t.reading === "working") || (data.pours?.cubes ?? []).some((c) => c.tests.some((t) => t.reading === "working"));
  useEffect(() => {
    if (!active || !reading) return;
    const timer = setInterval(() => void refresh(), 2_500);
    return () => clearInterval(timer);
  }, [active, reading, refresh]);

  // Opened from a phone alert: the truck's sheet opens, and the address drops the alert's part.
  const openedFromAlert = useRef(false);
  useEffect(() => {
    if (!openTruck || openedFromAlert.current || !loaded) return;
    const timer = setTimeout(() => {
      openedFromAlert.current = true;
      const url = new URL(window.location.href);
      url.searchParams.delete("open");
      url.searchParams.delete("alert");
      window.history.replaceState(null, "", url.pathname + url.search);
      if (data.trucks.some((t) => t.id === openTruck)) setOpenId(openTruck);
      else if (!offline) showToast({ text: "That truck isn't on the list any more." });
    }, 200);
    return () => clearTimeout(timer);
  }, [openTruck, loaded, data.trucks, offline, showToast]);

  const putTruck = useCallback((truck: Truck) => {
    localAt.current = Date.now();
    setData((d) => ({ ...d, trucks: sortTrucks([truck, ...d.trucks.filter((t) => t.id !== truck.id)]) }));
  }, []);
  // A pour booked, ticked or poured: the page as the website has it now.
  const putData = useCallback((next: ConcreteData) => {
    localAt.current = Date.now();
    setData(next);
  }, []);
  // A pre-pour photo in (they go up one by one, wherever the page is): the page as the website has it then.
  useEffect(() => {
    setPourDataSink(putData);
    return () => setPourDataSink(null);
  }, [putData]);
  const putPours = useCallback((pours: PourInfo | undefined) => {
    if (!pours) return;
    localAt.current = Date.now();
    setData((d) => ({ ...d, pours }));
  }, []);

  /* ---------- a waybill photo comes in ---------- */

  const sendPending = useCallback(
    async (p: Pending) => {
      setPending((list) => list.map((x) => (x.key === p.key ? { ...x, state: "sending", error: undefined } : x)));
      try {
        let photoId = p.photoId;
        if (!photoId) {
          photoId = (await uploadPhoto(p.file, "/api/concrete/photo")).id;
          setPending((list) => list.map((x) => (x.key === p.key ? { ...x, photoId } : x)));
        }
        const { truck, pours } = await send<{ truck: Truck; pours?: PourInfo }>("/api/concrete", "POST", { photoId, arrivedAt: p.at, arrivedFrom: p.from });
        URL.revokeObjectURL(p.preview);
        setPending((list) => list.filter((x) => x.key !== p.key));
        putTruck(truck);
        // Its day's booked pour is poured now: the page shows it.
        putPours(pours);
        setOpenId(truck.id);
      } catch (e) {
        setPending((list) => list.map((x) => (x.key === p.key ? { ...x, state: "error", error: errorText(e) } : x)));
      }
    },
    [putTruck, putPours]
  );

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    // The photo's own time first: shrinking it for the upload drops it.
    const arrival = await arrivalOf(file);
    const p: Pending = { key: ++counter.current, file, preview: URL.createObjectURL(file), ...arrival, state: "sending" };
    setPending((list) => [...list, p]);
    void sendPending(p);
  };

  const dropPending = (p: Pending) => {
    URL.revokeObjectURL(p.preview);
    if (p.photoId) forgetPhoto(p.photoId, "/api/concrete/photo");
    setPending((list) => list.filter((x) => x.key !== p.key));
  };

  /* ---------- the pours, each with its trucks ---------- */

  const today = ghanaDay();
  const info = data.pours;
  const bookings = useMemo(() => info?.pours ?? [], [info]);
  const { byPour, byDay } = useMemo(() => trucksByPour(data.trucks, bookings), [data.trucks, bookings]);
  const [folds, setFold] = useFolds();
  const [bookSheet, setBookSheet] = useState<{ booking: PourBooking | null } | null>(null);
  const pourOf = (day: string) => data.days.find((d) => d.day === day) ?? null;
  const bookingsOn = (day: string): PourBooking[] => bookings.filter((b) => b.day === day);
  const todays = trucksOn(data.trucks, today);
  const open = openId ? data.trucks.find((t) => t.id === openId) ?? null : null;
  const say = (text: string, error?: boolean) => showToast({ text, tone: error ? "error" : undefined });

  const cards: Card[] = [
    ...bookings.map((b) => ({ key: b.id, date: b.phase === "poured" && b.poured ? b.poured : b.day, booking: b, trucks: byPour.get(b.id) ?? [] })),
    ...[...byDay].map(([day, list]) => ({ key: `day:${day}`, date: day, day, trucks: list })),
  ];
  // Today's first (booked, going or done), then the pours booked (soonest first), then the ones poured (latest first).
  const onToday = cards.filter((c) => c.date === today || c.trucks.some((t) => t.day === today));
  const bookedCards = cards.filter((c) => !onToday.includes(c) && c.booking?.phase === "check").sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  const pastCards = cards.filter((c) => !onToday.includes(c) && !bookedCards.includes(c)).sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));

  const renderCard = (c: Card) => {
    if (c.booking && info) {
      const b = c.booking;
      const cubes = info.cubes?.find((x) => x.pourId === b.id) ?? noCubes(b.id);
      return (
        <PourCard
          key={c.key}
          booking={b}
          trucks={c.trucks}
          all={data.trucks}
          day={pourOf(b.day)}
          cubes={cubes}
          photos={info.photos ?? []}
          me={me}
          orderDefaults={info.orderDefaults}
          fold={folds[c.key]}
          onFold={(o) => setFold(c.key, o)}
          onData={putData}
          onToast={say}
          onChange={() => setBookSheet({ booking: b })}
          onOrder={onOrder}
          onTruck={setOpenId}
        />
      );
    }
    const day = c.day ?? c.date;
    return (
      <DayCard
        key={c.key}
        day={day}
        trucks={c.trucks}
        all={data.trucks}
        record={pourOf(day)}
        booked={bookingsOn(day).length}
        fold={folds[c.key]}
        onFold={(o) => setFold(c.key, o)}
        onTruck={setOpenId}
        onDay={() => setDayOpen(day)}
      />
    );
  };

  return (
    <>
      <SiteHeader title="Concrete" sub={todays.length ? `Today ${trucksWords(todays)}` : "No trucks today"} onMenu={() => setMenuOpen(true)} />

      {signedOut && (
        <div className={styles.banner} role="alert">
          You&rsquo;ve been signed out. <a href="/todo/concrete">Sign in again</a>
        </div>
      )}
      {offline && !signedOut && (
        <div className={styles.banner} role="status">
          No signal: showing the trucks as they were. A photo taken now waits here with its time until it can be sent.
        </div>
      )}

      <main className={styles.main}>
        {!loaded ? (
          <p className={styles.loading}>Loading the trucks…</p>
        ) : (
          <>
            <div className={styles.addBar}>
              <label htmlFor={CAMERA} className={styles.addPhoto} role="button" tabIndex={0}>
                <span aria-hidden="true">📷</span> Truck arrived
              </label>
              <label htmlFor={GALLERY} className={styles.addWrite} role="button" tabIndex={0}>
                From photos
              </label>
            </div>
            <p className={cx.hint}>
              {todays.length ? "" : "No trucks yet today. "}Photo the waybill as the truck arrives: the photo&rsquo;s time is its arrival. Consar to site takes about {ROAD_USUAL_MIN} min,{" "}
              {ROAD_MAX_MIN} at most.
            </p>

            {pending.map((p) => (
              <div key={p.key} className={`${cx.truck} ${cx.pending}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- the phone's own preview of the photo */}
                <img className={cx.thumb} src={p.preview} alt="" />
                <div className={cx.body}>
                  <p className={cx.truckName}>Truck at {clockOf(p.at)}</p>
                  {p.state === "sending" ? (
                    <p className={cx.line}>Sending the waybill photo…</p>
                  ) : (
                    <>
                      <p className={cx.flagBad}>{p.error}</p>
                      <div className={cx.pendingButtons}>
                        <button type="button" onClick={() => void sendPending(p)}>
                          Try again
                        </button>
                        <button type="button" onClick={() => dropPending(p)}>
                          Remove
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}

            {onToday.length > 0 && (
              <section className={styles.group} aria-label="Today">
                <h2 className={styles.groupTitle}>
                  {dayTitle(today)} {todays.length ? <span>{trucksWords(todays)}</span> : null}
                </h2>
                {onToday.map(renderCard)}
              </section>
            )}

            <section className={styles.group} aria-label="Pours booked">
              <h2 className={styles.groupTitle}>
                Booked <span>{bookedCards.length || ""}</span>
              </h2>
              {bookedCards.map(renderCard)}
              {info && (
                <button type="button" className={ps.book} onClick={() => setBookSheet({ booking: null })}>
                  + Book a pour
                </button>
              )}
              {!bookings.some((b) => b.phase === "check") && (
                <p className={ps.hint}>Book each pour before its day: its checklist goes with it, and the first waybill that day marks it poured and starts its curing.</p>
              )}
            </section>

            {pastCards.length > 0 && (
              <section className={styles.group} aria-label="Poured">
                <h2 className={styles.groupTitle}>Poured</h2>
                {pastCards.map(renderCard)}
              </section>
            )}

            {info && <PourChecklists lists={info.checklists} canEdit={!!info.canEditChecklists} onData={putData} onToast={say} />}
          </>
        )}
      </main>

      {bookSheet && info && (
        <BookSheet
          info={info}
          office={me.kind === "admin"}
          booking={bookSheet.booking}
          lastPour={lastPourWords(bookings, byPour)}
          onClose={() => setBookSheet(null)}
          onSaved={(next, text) => {
            putData(next);
            setBookSheet(null);
            say(text);
          }}
        />
      )}

      {/* "capture" opens the camera straight away on phones; the other picks a photo taken earlier. */}
      <input id={CAMERA} className={styles.hiddenInput} type="file" accept="image/*" capture="environment" onChange={(e) => void pick(e)} />
      <input id={GALLERY} className={styles.hiddenInput} type="file" accept="image/*" onChange={(e) => void pick(e)} />

      {open && (
        <TruckSheet
          key={open.id}
          me={me}
          truck={open}
          all={data.trucks}
          pour={pourOf(open.day)}
          bookings={bookingsOn(open.day)}
          onPours={putPours}
          onClose={() => setOpenId(null)}
          onSaved={(truck, note) => {
            putTruck(truck);
            if (note) showToast({ text: note });
          }}
          onDeleted={(id, pours) => {
            localAt.current = Date.now();
            setData((d) => ({ ...d, trucks: d.trucks.filter((t) => t.id !== id), ...(pours ? { pours } : {}) }));
            setOpenId(null);
            showToast({ text: "Truck deleted" });
          }}
          onPhoto={setLightbox}
        />
      )}
      {dayOpen && (
        <DaySheet
          day={dayOpen}
          pour={pourOf(dayOpen)}
          onClose={() => setDayOpen(null)}
          onSaved={(pour) => {
            localAt.current = Date.now();
            setData((d) => ({ ...d, days: [...d.days.filter((x) => x.day !== pour.day), pour] }));
            setDayOpen(null);
            showToast({ text: "Saved" });
          }}
        />
      )}

      {menuOpen && <SiteMenu me={me} onClose={() => setMenuOpen(false)} onRefresh={() => void refresh()} onLogins={() => setAccessOpen(true)} />}
      {accessOpen && <AccessSheet onClose={() => setAccessOpen(false)} />}

      {lightbox && (
        <div className={styles.lightbox} onClick={() => setLightbox(null)} role="dialog" aria-label="Waybill">
          {/* eslint-disable-next-line @next/next/no-img-element -- full-size view from the image store */}
          <img src={photoAt(lightbox, 2000)} alt="" />
          <div className={styles.lightboxBar}>
            <a href={lightbox} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
              Save the photo
            </a>
            <button type="button" onClick={() => setLightbox(null)}>
              Close
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className={`${styles.toast} ${toast.tone === "error" ? styles.toastError : ""}`} role="status">
          <span>{toast.text}</span>
        </div>
      )}
    </>
  );
}

/* ---------- one truck: what the waybill says, the times, the tests ---------- */

type Form = {
  arrivedTime: string;
  yardTime: string;
  waybillDate: string;
  lorry: string;
  driver: string;
  waybillNo: string;
  supplier: string;
  volume: string;
  mix: string;
  aggregate: string;
  additive: string;
  slump: string;
  cubes: boolean;
  comment: string;
};

const fromTruck = (t: Truck): Form => ({
  arrivedTime: clockOf(t.arrivedAt),
  yardTime: t.yardTime ?? "",
  waybillDate: t.waybillDate ?? "",
  lorry: t.lorry ?? "",
  driver: t.driver ?? "",
  waybillNo: t.waybillNo ?? "",
  supplier: t.supplier ?? "",
  volume: t.volume !== null ? String(t.volume) : "",
  mix: t.mix ?? "",
  aggregate: t.aggregate ?? "",
  additive: t.additive ?? "",
  slump: t.slump !== null ? String(t.slump) : "",
  cubes: t.cubes,
  comment: t.comment,
});

const COMMENTS = ["Good", "Too wet", "Too stiff", "Waited on site"];

function TruckSheet({
  me,
  truck,
  all,
  pour,
  bookings,
  onPours,
  onClose,
  onSaved,
  onDeleted,
  onPhoto,
}: {
  me: TodoMe;
  truck: Truck;
  all: Truck[];
  pour: PourDay | null;
  /** The pours booked on the truck's day. */
  bookings: PourBooking[];
  onPours: (pours: PourInfo | undefined) => void;
  onClose: () => void;
  onSaved: (truck: Truck, note?: string) => void;
  onDeleted: (id: string, pours?: PourInfo) => void;
  onPhoto: (url: string) => void;
}) {
  // Only what's been typed is kept here: the rest follows the truck, so a reading that lands while the sheet
  // is open fills the fields not touched.
  const [edits, setEdits] = useState<Partial<Form>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [armed, setArmed] = useState(false);
  const form: Form = { ...fromTruck(truck), ...edits };
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setEdits((e) => ({ ...e, [key]: value }));
  const working = truck.reading === "working";

  // The truck as it would be saved, for the road time and the checks while typing.
  const draft: Truck = {
    ...truck,
    arrivedAt: tidyTime(form.arrivedTime) && "arrivedTime" in edits ? new Date(`${truck.day}T${tidyTime(form.arrivedTime)}:00Z`).toISOString() : truck.arrivedAt,
    yardTime: tidyTime(form.yardTime),
    waybillDate: /^\d{4}-\d{2}-\d{2}$/.test(form.waybillDate) ? form.waybillDate : null,
    waybillNo: form.waybillNo.trim() || null,
    mix: form.mix.trim() || null,
  };
  const minutes = roadMinutes(draft);
  const flags = truckFlags(draft, all, pour);
  const canDelete = me.kind === "admin" || truck.createdById === me.id;
  const number = trucksOn(all, truck.day).findIndex((t) => t.id === truck.id) + 1;

  const save = async () => {
    const keys = Object.keys(edits) as (keyof Form)[];
    if (!keys.length) {
      onClose();
      return;
    }
    setSaving(true);
    setError("");
    try {
      const body: Record<string, unknown> = {};
      for (const k of keys) body[k] = form[k];
      const { truck: saved } = await send<{ truck: Truck }>(`/api/concrete/${truck.id}`, "PATCH", body);
      onSaved(saved, "Saved");
      onClose();
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };

  // Two pours booked that day: which one this truck brought (that one is poured, its curing starts).
  const pickPour = async (pourId: string) => {
    setSaving(true);
    setError("");
    try {
      const { truck: saved, pours } = await send<{ truck: Truck; pours?: PourInfo }>(`/api/concrete/${truck.id}`, "PATCH", { pourId });
      onPours(pours);
      onSaved(saved, "Poured: its curing starts");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const readAgain = async () => {
    setError("");
    try {
      const { truck: saved } = await send<{ truck: Truck }>(`/api/concrete/${truck.id}`, "PATCH", { action: "read" });
      onSaved(saved);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const remove = async () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setSaving(true);
    try {
      const { pours } = await send<{ ok: boolean; pours?: PourInfo }>(`/api/concrete/${truck.id}`, "DELETE");
      onDeleted(truck.id, pours);
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
      setArmed(false);
    }
  };

  const field = (key: keyof Omit<Form, "cubes">, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className={cx.field}>
      <span className={styles.label}>{label}</span>
      <input className={styles.input} value={form[key]} onChange={(e) => set(key, e.target.value)} maxLength={MAX_FIELD} disabled={saving} {...extra} />
    </label>
  );

  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label="Concrete truck">
        <h2 className={styles.sheetTitle}>
          Truck #{number || "?"} · {shortDate(truck.day)}
        </h2>
        {truck.photoUrl && (
          <button type="button" className={cx.sheetPhoto} onClick={() => onPhoto(truck.photoUrl!)} aria-label="Open the waybill photo">
            {/* eslint-disable-next-line @next/next/no-img-element -- a resized copy from the image store */}
            <img src={photoAt(truck.photoUrl, 900)} alt="" />
          </button>
        )}
        <TruckPour truck={truck} bookings={bookings} onPick={(id) => void pickPour(id)} busy={saving} />
        {working ? (
          <p className={cx.reading}>Reading the waybill… its details fill in by themselves in a few seconds.</p>
        ) : (
          truck.readNotes.map((n) => (
            <p key={n} className={cx.readNote}>
              {n}
            </p>
          ))
        )}

        <div className={`${cx.road} ${minutes === null ? "" : minutes < 0 || minutes > ROAD_MAX_MIN ? cx.roadBad : minutes < 7 ? cx.roadCheck : cx.roadOk}`}>
          <span className={cx.roadMinutes}>{minutes === null ? "–" : minutes < 0 ? "?" : minutes}</span>
          <span>
            {minutes === null
              ? working
                ? "minutes from the yard: waiting for the waybill"
                : "minutes from the yard: type the waybill's time"
              : minutes < 0
                ? "the photo is earlier than the waybill's time"
                : `minutes from the yard (${ROAD_USUAL_MIN} with no traffic, ${ROAD_MAX_MIN} at most)`}
          </span>
        </div>
        <Flags flags={flags.filter((f) => f.kind !== "late" && f.kind !== "notime")} />

        <div className={cx.grid2}>
          {field("yardTime", "Left the yard", { type: "time", disabled: saving || (working && !("yardTime" in edits)) })}
          {field("arrivedTime", "On site", { type: "time" })}
        </div>
        <p className={cx.small}>On site: {"arrivedTime" in edits ? "typed in" : FROM_WORDS[truck.arrivedFrom]}.</p>

        <div className={cx.grid2}>
          {field("slump", "Slump (mm)", { inputMode: "numeric", placeholder: "e.g. 100" })}
          <div className={cx.field}>
            <span className={styles.label}>Cubes</span>
            <button type="button" className={form.cubes ? cx.toggleOn : cx.toggleOff} aria-pressed={form.cubes} onClick={() => set("cubes", !form.cubes)} disabled={saving}>
              {form.cubes ? "✓ Cubes taken" : "No cubes taken"}
            </button>
          </div>
        </div>

        <label className={styles.label} htmlFor="truck-comment">
          Comment
        </label>
        <div className={styles.chips}>
          {COMMENTS.map((c) => (
            <button
              key={c}
              type="button"
              className={styles.chip}
              disabled={saving}
              onClick={() => set("comment", form.comment.trim() ? `${form.comment.trim().replace(/[.,]$/, "")}, ${c.toLowerCase()}` : c)}
            >
              {c}
            </button>
          ))}
        </div>
        <textarea
          id="truck-comment"
          className={styles.textarea}
          value={form.comment}
          onChange={(e) => set("comment", e.target.value)}
          maxLength={MAX_COMMENT}
          rows={2}
          placeholder="e.g. Too soft, added nothing on site"
          disabled={saving}
        />

        <p className={styles.label}>From the waybill</p>
        <div className={cx.grid2}>
          {field("lorry", "Truck", { placeholder: working ? "reading…" : "GR 1234-24", disabled: saving || (working && !("lorry" in edits)) })}
          {field("volume", "Volume (m³)", { inputMode: "decimal", placeholder: working ? "reading…" : "10", disabled: saving || (working && !("volume" in edits)) })}
          {field("mix", "Mix", { placeholder: working ? "reading…" : "25 MPa", disabled: saving || (working && !("mix" in edits)) })}
          {field("waybillNo", "Waybill no.", { inputMode: "numeric", disabled: saving || (working && !("waybillNo" in edits)) })}
          {field("driver", "Driver", { disabled: saving || (working && !("driver" in edits)) })}
          {field("waybillDate", "Waybill date", { type: "date", disabled: saving || (working && !("waybillDate" in edits)) })}
          {field("aggregate", "Aggregate", { disabled: saving || (working && !("aggregate" in edits)) })}
          {field("supplier", "Supplier", { disabled: saving || (working && !("supplier" in edits)) })}
        </div>
        {field("additive", "Additive or requirement", { disabled: saving || (working && !("additive" in edits)) })}
        <p className={cx.small}>
          Logged by {truck.createdBy || "someone"}
          {!working && truck.reading !== "failed" ? " · read off the photo" : ""}.
        </p>

        {error && <p className={styles.sheetError}>{error}</p>}

        <div className={cx.sheetLinks}>
          {!working && (
            <button type="button" onClick={() => void readAgain()} disabled={saving}>
              Read the waybill again
            </button>
          )}
          {canDelete && (
            <button type="button" className={armed ? styles.dangerArmed : styles.danger} onClick={() => void remove()} disabled={saving}>
              {armed ? "Tap again to delete this truck" : "Delete this truck"}
            </button>
          )}
        </div>

        <div className={styles.sheetButtons}>
          <button type="button" className={styles.sheetCancel} onClick={onClose} disabled={saving}>
            Close
          </button>
          <button type="button" className={styles.sheetSave} onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- the day: what's poured and what was ordered ---------- */

function DaySheet({ day, pour, onClose, onSaved }: { day: string; pour: PourDay | null; onClose: () => void; onSaved: (pour: PourDay) => void }) {
  const [what, setWhat] = useState(pour?.pour ?? "");
  const [mix, setMix] = useState(pour?.mix ?? "");
  const [volume, setVolume] = useState(pour?.volume ? String(pour.volume) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const { day: saved } = await send<{ day: PourDay }>("/api/concrete/day", "POST", { day, pour: what, mix, volume });
      onSaved(saved);
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };

  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label="The pour">
        <h2 className={styles.sheetTitle}>The pour · {shortDate(day)}</h2>
        <p className={styles.sheetNote}>A truck that brings a different mix from the one ordered is flagged, and the day shows how much has come in.</p>
        <label className={styles.label} htmlFor="pour-what">
          What&rsquo;s being poured
        </label>
        <input id="pour-what" className={styles.input} value={what} onChange={(e) => setWhat(e.target.value)} maxLength={120} placeholder="e.g. 2nd floor slab and beams" />
        <div className={cx.grid2}>
          <label className={cx.field}>
            <span className={styles.label}>Mix ordered</span>
            <input className={styles.input} value={mix} onChange={(e) => setMix(e.target.value)} maxLength={40} placeholder="e.g. 25 MPa" />
          </label>
          <label className={cx.field}>
            <span className={styles.label}>Ordered (m³)</span>
            <input className={styles.input} value={volume} onChange={(e) => setVolume(e.target.value)} inputMode="decimal" placeholder="e.g. 40" />
          </label>
        </div>
        {error && <p className={styles.sheetError}>{error}</p>}
        <div className={styles.sheetButtons}>
          <button type="button" className={styles.sheetCancel} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className={styles.sheetSave} onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
