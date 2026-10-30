"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  clockOf,
  cubic,
  daySummary,
  leftYardAt,
  MAX_COMMENT,
  MAX_FIELD,
  roadMinutes,
  ROAD_MAX_MIN,
  ROAD_USUAL_MIN,
  shortDate,
  tidyTime,
  truckFlags,
  trucksOn,
  type ArrivedFrom,
  type ConcreteData,
  type Flag,
  type PourDay,
  type Truck,
} from "@/lib/concrete/shared";
import { ghanaDay } from "@/lib/store/shared";
import { photoAt, type TodoMe } from "@/lib/todo/shared";
import { AccessSheet } from "./AccessSheet";
import { errorText, send, startPolling } from "./api";
import cx from "./Concrete.module.css";
import { forgetPhoto, uploadPhoto } from "./photo";
import { arrivalOf } from "./photoTime";
import { SiteHeader, SiteMenu } from "./SiteChrome";
import styles from "./Todo.module.css";

// The concrete trucks on a pour day (lib/concrete/shared.ts says what and why). "Truck arrived" opens the
// camera: the photo of the waybill makes the truck at once, timed by the photo, and its sheet opens while
// Claude reads the waybill; the slump, cubes and a comment go in when the tests are done. Each day shows its
// trucks in the order they came, how long each took from the yard, and anything that doesn't add up.

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
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sortTrucks = (list: Truck[]) => [...list].sort((a, b) => b.arrivedAt.localeCompare(a.arrivedAt));

/** The road time as a badge: green within the limit, red over it or impossible, amber when it can't be worked out. */
function RoadBadge({ minutes, waiting }: { minutes: number | null; waiting?: boolean }) {
  if (minutes === null) return <span className={`${cx.badge} ${cx.badgeWait}`}>{waiting ? "reading…" : "no time"}</span>;
  const tone = minutes < 0 || minutes > ROAD_MAX_MIN ? cx.badgeBad : minutes < 7 ? cx.badgeCheck : cx.badgeOk;
  return <span className={`${cx.badge} ${tone}`}>{minutes < 0 ? "check time" : `${minutes} min`}</span>;
}

function Flags({ flags }: { flags: Flag[] }) {
  if (!flags.length) return null;
  return (
    <ul className={cx.flags}>
      {flags.map((f) => (
        <li key={f.kind} className={f.tone === "bad" ? cx.flagBad : cx.flagCheck}>
          {f.text}
        </li>
      ))}
    </ul>
  );
}

export function ConcreteApp({
  me,
  active,
  initial,
  openTruck,
  startedOffline,
  fresh,
}: {
  me: TodoMe;
  active: boolean;
  /** Null when the app opened on another part and the trucks haven't arrived yet. */
  initial: ConcreteData | null;
  /** Opened from a phone alert about a truck: that truck's sheet opens. */
  openTruck?: string;
  startedOffline: boolean;
  fresh: boolean;
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

  // While a waybill is being read: look every few seconds, so its details appear as soon as they're in.
  const reading = data.trucks.some((t) => t.reading === "working");
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
        const { truck } = await send<{ truck: Truck }>("/api/concrete", "POST", { photoId, arrivedAt: p.at, arrivedFrom: p.from });
        URL.revokeObjectURL(p.preview);
        setPending((list) => list.filter((x) => x.key !== p.key));
        putTruck(truck);
        setOpenId(truck.id);
      } catch (e) {
        setPending((list) => list.map((x) => (x.key === p.key ? { ...x, state: "error", error: errorText(e) } : x)));
      }
    },
    [putTruck]
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

  /* ---------- the days ---------- */

  const today = ghanaDay();
  const days = useMemo(() => {
    const set = new Set(data.trucks.map((t) => t.day));
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [data.trucks]);
  const pourOf = (day: string) => data.days.find((d) => d.day === day) ?? null;
  const todays = trucksOn(data.trucks, today);
  const todaySum = daySummary(todays);
  const open = openId ? data.trucks.find((t) => t.id === openId) ?? null : null;

  return (
    <>
      <SiteHeader
        title="Concrete"
        sub={todays.length ? `Today ${plural(todaySum.trucks, "truck")} · ${cubic(todaySum.volume)} m³` : "No trucks today"}
        onMenu={() => setMenuOpen(true)}
      />

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
              Photo the waybill as the truck arrives: the photo&rsquo;s time is its arrival. Consar to site takes about {ROAD_USUAL_MIN} min, {ROAD_MAX_MIN} at most.
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

            {!days.includes(today) && (
              <section className={styles.group}>
                <h2 className={styles.groupTitle}>{dayTitle(today)}</h2>
                <PourLine pour={pourOf(today)} delivered={0} onEdit={() => setDayOpen(today)} />
                {!pending.length && <p className={styles.empty}>No trucks yet today. When a concrete truck arrives, tap Truck arrived and photo its waybill.</p>}
              </section>
            )}

            {days.map((day) => {
              const list = trucksOn(data.trucks, day);
              const sum = daySummary(list);
              const pour = pourOf(day);
              const late = list.filter((t) => truckFlags(t, data.trucks, pour).some((f) => f.tone === "bad")).length;
              return (
                <section key={day} className={styles.group}>
                  <h2 className={styles.groupTitle}>
                    {dayTitle(day)}{" "}
                    <span>
                      {plural(sum.trucks, "truck")} · {cubic(sum.volume)} m³
                    </span>
                  </h2>
                  <PourLine pour={pour} delivered={sum.volume} onEdit={() => setDayOpen(day)} />
                  {(sum.averageRoad !== null || late > 0) && (
                    <p className={cx.dayStats}>
                      {sum.averageRoad !== null ? `Average ${sum.averageRoad} min from the yard` : ""}
                      {sum.averageRoad !== null && late ? " · " : ""}
                      {late ? <b className={cx.bad}>{plural(late, "truck")} to look at</b> : null}
                    </p>
                  )}
                  {[...list].reverse().map((t) => (
                    <TruckCard key={t.id} truck={t} number={list.indexOf(t) + 1} flags={truckFlags(t, data.trucks, pour)} onOpen={() => setOpenId(t.id)} />
                  ))}
                </section>
              );
            })}
          </>
        )}
      </main>

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
          onClose={() => setOpenId(null)}
          onSaved={(truck, note) => {
            putTruck(truck);
            if (note) showToast({ text: note });
          }}
          onDeleted={(id) => {
            localAt.current = Date.now();
            setData((d) => ({ ...d, trucks: d.trucks.filter((t) => t.id !== id) }));
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

/** What the day's pour is and what was ordered, with a button to say. */
function PourLine({ pour, delivered, onEdit }: { pour: PourDay | null; delivered: number; onEdit: () => void }) {
  const said = pour && (pour.pour || pour.mix || pour.volume);
  return (
    <div className={cx.pourLine}>
      {said ? (
        <p>
          {pour.pour ? <b>{pour.pour}</b> : null}
          {pour.pour && (pour.mix || pour.volume) ? " · " : ""}
          {pour.mix || pour.volume ? `ordered ${[pour.mix, pour.volume ? `${cubic(pour.volume)} m³` : ""].filter(Boolean).join(", ")}` : ""}
          {pour.volume ? (
            <span className={delivered > pour.volume ? cx.bad : undefined}>
              {" "}
              · {cubic(delivered)} of {cubic(pour.volume)} m³ in
            </span>
          ) : null}
        </p>
      ) : (
        <p className={cx.muted}>What&rsquo;s being poured, and the mix ordered?</p>
      )}
      <button type="button" onClick={onEdit}>
        {said ? "Change" : "Add"}
      </button>
    </div>
  );
}

function TruckCard({ truck: t, number, flags, onOpen }: { truck: Truck; number: number; flags: Flag[]; onOpen: () => void }) {
  const minutes = roadMinutes(t);
  const left = leftYardAt(t);
  const tests = [t.slump ? `Slump ${t.slump} mm` : "", t.cubes ? "Cubes taken" : ""].filter(Boolean).join(" · ");
  return (
    <button type="button" id={t.id} className={`${cx.truck} ${flags.some((f) => f.tone === "bad") ? cx.truckBad : ""}`} onClick={onOpen}>
      {t.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a resized copy from the image store
        <img className={cx.thumb} src={photoAt(t.photoUrl, 240)} alt="" loading="lazy" />
      ) : (
        <span className={cx.thumb} />
      )}
      <span className={cx.body}>
        <span className={cx.truckTop}>
          <span className={cx.truckName}>
            #{number} {t.lorry ?? (t.reading === "working" ? "" : "Truck")}
            {t.volume ? ` · ${cubic(t.volume)} m³` : ""}
          </span>
          <RoadBadge minutes={minutes} waiting={t.reading === "working"} />
        </span>
        <span className={cx.line}>
          {t.reading === "working"
            ? `On site ${clockOf(t.arrivedAt)} · reading the waybill…`
            : left
              ? `Left the yard ${clockOf(left)} · on site ${clockOf(t.arrivedAt)}`
              : `On site ${clockOf(t.arrivedAt)}`}
        </span>
        {(t.mix || tests) && <span className={cx.line}>{[t.mix, tests].filter(Boolean).join(" · ")}</span>}
        {t.comment && <span className={cx.comment}>&ldquo;{t.comment}&rdquo;</span>}
        {t.reading === "failed" && <span className={cx.flagCheck}>The waybill couldn&rsquo;t be read: tap to type it in.</span>}
        <Flags flags={flags.filter((f) => !(f.kind === "notime" && t.reading === "failed"))} />
      </span>
    </button>
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
  onClose,
  onSaved,
  onDeleted,
  onPhoto,
}: {
  me: TodoMe;
  truck: Truck;
  all: Truck[];
  pour: PourDay | null;
  onClose: () => void;
  onSaved: (truck: Truck, note?: string) => void;
  onDeleted: (id: string) => void;
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
      await send(`/api/concrete/${truck.id}`, "DELETE");
      onDeleted(truck.id);
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
