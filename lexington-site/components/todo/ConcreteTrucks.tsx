"use client";

import {
  clockOf,
  cubic,
  daySummary,
  delivered,
  leftYardAt,
  roadMinutes,
  ROAD_MAX_MIN,
  truckFlags,
  trucksOn,
  type Flag,
  type PourDay,
  type Truck,
} from "@/lib/concrete/shared";
import { photoAt } from "@/lib/todo/shared";
import cx from "./Concrete.module.css";

// The trucks inside a pour's card on the concrete page (25 Nov 2026, Niko: "one pour is on top and then the photos of
// the waybills for the truck is at the bottom. put them together"): what came against what was ordered and worked out,
// how long they took from the yard, and each truck with its waybill photo. A truck whose waybill has no m³ (torn,
// smudged) counts at the usual load until it's typed in, and says so (24 Nov: 7 trucks came, the page said 60 of 60 m³).

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "7 trucks · 70 m³", "7 trucks · about 70 m³" (one with no m³ on its waybill, counted at the usual load). */
export function trucksWords(list: readonly Truck[]): string {
  if (!list.length) return "";
  const got = delivered(list);
  return `${plural(list.length, "truck")} · ${got.missing && got.usual ? "about " : ""}${cubic(got.missing && got.usual ? got.likely : got.known)} m³`;
}

/** The road time as a badge: green within the limit, red over it or impossible, amber when it can't be worked out. */
export function RoadBadge({ minutes, waiting }: { minutes: number | null; waiting?: boolean }) {
  if (minutes === null) return <span className={`${cx.badge} ${cx.badgeWait}`}>{waiting ? "reading…" : "no time"}</span>;
  const tone = minutes < 0 || minutes > ROAD_MAX_MIN ? cx.badgeBad : minutes < 7 ? cx.badgeCheck : cx.badgeOk;
  return <span className={`${cx.badge} ${tone}`}>{minutes < 0 ? "check time" : `${minutes} min`}</span>;
}

export function Flags({ flags }: { flags: Flag[] }) {
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

export function TruckCard({ truck: t, number, flags, onOpen }: { truck: Truck; number: number; flags: Flag[]; onOpen: () => void }) {
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
        <Flags flags={flags.filter((f) => !((f.kind === "notime" || f.kind === "novolume") && t.reading === "failed"))} />
      </span>
    </button>
  );
}

/**
 * A pour's trucks (or a day's): what came against what was ordered, what the drawings worked out once the day is over,
 * the time from the yard, then the trucks, the last one first. `all` is every truck on the page (the checks compare
 * them), `day` the pour day's record (the mix ordered), `today` whether the pour is still going.
 */
export function TruckList({
  trucks,
  all,
  day,
  ordered,
  worked,
  going,
  onOpen,
}: {
  trucks: readonly Truck[];
  all: readonly Truck[];
  day: PourDay | null;
  /** m³ ordered, if said. */
  ordered: number | null;
  /** m³ worked out from the drawings, if it was. */
  worked: number | null;
  going: boolean;
  onOpen: (id: string) => void;
}) {
  if (!trucks.length) return null;
  const got = delivered(trucks);
  const sum = daySummary(trucks);
  const guessed = got.missing > 0 && got.usual !== null;
  const came = guessed ? got.likely : got.known;
  const numberOf = (t: Truck) => trucksOn(all, t.day).findIndex((x) => x.id === t.id) + 1;
  const missing = trucks.filter((t) => t.volume === null && t.reading !== "working");
  const flagged = trucks.filter((t) => truckFlags(t, all, day).some((f) => f.tone === "bad")).length;
  const more = worked && worked > 0 && came > 0 ? Math.round((came / worked - 1) * 100) : null;
  return (
    <div className={cx.trucks}>
      <p className={cx.came}>
        {plural(trucks.length, "truck")} · {guessed ? "about " : ""}
        {cubic(came)} m³ in
        {ordered ? <span className={came > ordered ? cx.bad : undefined}> of {cubic(ordered)} ordered</span> : null}
      </p>
      {missing.length > 0 && (
        <p className={cx.flagCheck}>
          {missing.length === 1
            ? `Truck #${numberOf(missing[0])} has no m³ on its waybill${got.usual !== null ? `: counted as ${cubic(got.usual)} m³ until it's typed in.` : ": tap it to type it in."}`
            : `Trucks ${missing.map((t) => `#${numberOf(t)}`).join(", ")} have no m³ on their waybills${got.usual !== null ? `: counted as ${cubic(got.usual)} m³ each until typed in.` : ": tap each to type it in."}`}
        </p>
      )}
      {worked && !going && more !== null && (
        <p className={cx.line}>
          Worked out when it was booked: {cubic(worked)} m³.{" "}
          {Math.abs(more) < 3 ? "About that came." : <b className={more > 0 ? cx.bad : undefined}>{`${guessed ? "About " : ""}${Math.abs(more)}% ${more > 0 ? "more" : "less"} came.`}</b>}
        </p>
      )}
      {(sum.averageRoad !== null || flagged > 0) && (
        <p className={cx.line}>
          {sum.averageRoad !== null ? `Average ${sum.averageRoad} min from the yard` : ""}
          {sum.averageRoad !== null && flagged ? " · " : ""}
          {flagged ? <b className={cx.bad}>{plural(flagged, "truck")} to look at</b> : null}
        </p>
      )}
      <div className={cx.truckGrid}>
        {[...trucks].reverse().map((t) => (
          <TruckCard key={t.id} truck={t} number={numberOf(t)} flags={truckFlags(t, all, day)} onOpen={() => onOpen(t.id)} />
        ))}
      </div>
    </div>
  );
}

/** What a day's pour is and what was ordered, with a button to say (a day with trucks and no pour booked). */
export function DayLine({ pour, trucks, onEdit }: { pour: PourDay | null; trucks: readonly Truck[]; onEdit: () => void }) {
  const said = pour && (pour.pour || pour.mix || pour.volume);
  const got = delivered(trucks);
  const came = got.missing && got.usual !== null ? got.likely : got.known;
  return (
    <div className={cx.pourLine}>
      {said ? (
        <p>
          {pour.pour ? <b>{pour.pour}</b> : null}
          {pour.pour && (pour.mix || pour.volume) ? " · " : ""}
          {pour.mix || pour.volume ? `ordered ${[pour.mix, pour.volume ? `${cubic(pour.volume)} m³` : ""].filter(Boolean).join(", ")}` : ""}
          {pour.volume ? (
            <span className={came > pour.volume ? cx.bad : undefined}>
              {" "}
              · {got.missing && got.usual !== null ? "about " : ""}
              {cubic(came)} of {cubic(pour.volume)} m³ in
            </span>
          ) : null}
        </p>
      ) : (
        <p className={cx.muted}>What was poured, and the mix ordered?</p>
      )}
      <button type="button" onClick={onEdit}>
        {said ? "Change" : "Add"}
      </button>
    </div>
  );
}
