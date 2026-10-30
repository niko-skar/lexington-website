// Concrete deliveries on pour days (/todo/concrete). Niko, 30 Oct 2026: "on concrete pour days I get waybills
// for each concrete truck that I want to be able to take a photo of and it records automatically all the
// information for. the time it left the yard, the quantity, which truck, etc. ... the time I took the photo
// serves as the time the truck reached my site, so any discrepancies should alert me, like 45 min from yard to
// my site is too long, consar to my site is only 10 min no traffic, and 25 min max with traffic ... also a
// comment box to say that it was too soft or hard or something. a space for a slump test result per truck as
// well. and cube test taken check or no (not required)".
//
// One record per truck: the waybill photo, what Claude read off it, when it arrived (the photo's own time),
// and the site's checks (slump, cubes, a comment). One small record per pour day says what was poured and
// what was ordered, so a truck with a different mix stands out. Ghana keeps UTC all year, so a day here is
// the UTC date and a waybill's "10:35" is 10:35 UTC.

/** Consar's yard to the site: about 10 minutes with no traffic, 25 at most with it (Niko). */
export const ROAD_USUAL_MIN = 10;
export const ROAD_MAX_MIN = 25;
/** Quicker than the road allows: the time on the waybill was probably written after the truck left. */
export const ROAD_TOO_QUICK_MIN = 7;

export const MAX_FIELD = 80;
export const MAX_COMMENT = 400;
/** A truck mixer carries up to about 12 m³; anything over this is a misreading. */
export const MAX_VOLUME = 20;
/** Slump in millimetres (a collapse of more than this isn't a slump test). */
export const MAX_SLUMP = 300;

/** Where a truck's arrival time came from: the photo's own time, the photo file's time, the moment it was added, or typed. */
export type ArrivedFrom = "photo" | "file" | "now" | "typed";

export interface Truck {
  id: string;
  /** The arrival day in Ghana, YYYY-MM-DD. */
  day: string;
  /** When the waybill photo was taken: the time the truck reached the site. */
  arrivedAt: string;
  arrivedFrom: ArrivedFrom;
  photoUrl: string | null;
  /** Claude reading the waybill: still going, done, or it couldn't (then it can be typed). */
  reading: "working" | "done" | "failed";
  /** What to double-check about the reading, in plain words. */
  readNotes: string[];
  supplier: string | null;
  waybillNo: string | null;
  lorry: string | null;
  driver: string | null;
  /** The date written on the waybill, YYYY-MM-DD. */
  waybillDate: string | null;
  /** The time written on the waybill (when it left the yard), HH:MM. */
  yardTime: string | null;
  /** Cubic metres. */
  volume: number | null;
  mix: string | null;
  aggregate: string | null;
  additive: string | null;
  /** The slump test, in mm. */
  slump: number | null;
  /** Cubes taken for testing (not required). */
  cubes: boolean;
  comment: string;
  createdAt: string;
  createdBy: string;
  createdById: string | null;
  updatedAt: string;
}

/** What was poured on a day and what was ordered (all optional). */
export interface PourDay {
  day: string;
  pour: string;
  mix: string;
  /** m³ ordered, or null. */
  volume: number | null;
}

export interface ConcreteData {
  trucks: Truck[];
  days: PourDay[];
}

export type FlagKind = "late" | "quick" | "before" | "date" | "twice" | "mix" | "notime";
export interface Flag {
  kind: FlagKind;
  /** "bad": something went wrong; "check": worth a look. */
  tone: "bad" | "check";
  text: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "30 Oct" */
export const shortDate = (day: string) => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1] ?? ""}`;
/** "10:35" in Ghana time. */
export const clockOf = (iso: string) => new Date(iso).toISOString().slice(11, 16);
/** "1.5", "10" */
export const cubic = (n: number) => `${Math.round(n * 10) / 10}`;

/** A time as the waybill or a person writes it ("10:35", "10.35", "1035", "9:5") as HH:MM, or null. */
export function tidyTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^\s*(\d{1,2})\s*[:.h]?\s*(\d{2})\s*$/i.exec(value);
  if (!m) return null;
  const [h, mi] = [Number(m[1]), Number(m[2])];
  return h <= 23 && mi <= 59 ? `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}` : null;
}

/**
 * When the truck left the yard, from the waybill's date and time. A plant may write "1:15" for 1:15 in the
 * afternoon: when the morning reading would put the truck on the road for over six hours and the afternoon
 * one fits, the afternoon one is taken.
 */
export function leftYardAt(t: Pick<Truck, "day" | "arrivedAt" | "waybillDate" | "yardTime">): string | null {
  const time = tidyTime(t.yardTime);
  if (!time) return null;
  const date = t.waybillDate && /^\d{4}-\d{2}-\d{2}$/.test(t.waybillDate) ? t.waybillDate : t.day;
  const at = Date.parse(`${date}T${time}:00Z`);
  if (Number.isNaN(at)) return null;
  const arrived = Date.parse(t.arrivedAt);
  const hour = Number(time.slice(0, 2));
  const gap = (x: number) => (arrived - x) / 60_000;
  if (hour < 12 && gap(at) > 360 && gap(at + 12 * 3_600_000) >= -30 && gap(at + 12 * 3_600_000) <= 360) return new Date(at + 12 * 3_600_000).toISOString();
  return new Date(at).toISOString();
}

/** Minutes from the yard to the site (the photo's time less the waybill's), or null when the waybill has no time. */
export function roadMinutes(t: Pick<Truck, "day" | "arrivedAt" | "waybillDate" | "yardTime">): number | null {
  const left = leftYardAt(t);
  return left ? Math.round((Date.parse(t.arrivedAt) - Date.parse(left)) / 60_000) : null;
}

/** The strength in a mix as a number ("25 MPa", "C25", "Grade 25" -> 25), to compare two mixes. */
export const mixStrength = (mix: string | null | undefined): number | null => {
  const m = /(\d{2})(?:\s*\/\s*\d{2})?/.exec(mix ?? "");
  return m ? Number(m[1]) : null;
};
const sameMix = (a: string, b: string) => {
  const [x, y] = [mixStrength(a), mixStrength(b)];
  return x !== null && y !== null ? x === y : a.trim().toLowerCase() === b.trim().toLowerCase();
};

/** The mix most of the day's trucks brought (for spotting the odd one), when two or more trucks agree. */
function usualMix(dayTrucks: Truck[]): string | null {
  const counts = new Map<string, { mix: string; n: number }>();
  for (const t of dayTrucks) {
    if (!t.mix) continue;
    const key = String(mixStrength(t.mix) ?? t.mix.trim().toLowerCase());
    const hit = counts.get(key) ?? { mix: t.mix, n: 0 };
    hit.n++;
    counts.set(key, hit);
  }
  const best = [...counts.values()].sort((a, b) => b.n - a.n);
  return best[0] && best[0].n >= 2 && (best.length === 1 || best[0].n > best[1].n) ? best[0].mix : null;
}

/**
 * What doesn't add up about one truck: a long or impossibly quick road time, a photo earlier than the
 * waybill, a waybill from another day, the same waybill twice, a different mix from the one ordered (or
 * from the other trucks). `all` is every truck on the list, `day` that day's pour, if written.
 */
export function truckFlags(t: Truck, all: readonly Truck[], day?: PourDay | null): Flag[] {
  const flags: Flag[] = [];
  const minutes = roadMinutes(t);
  if (minutes !== null) {
    if (minutes < 0) flags.push({ kind: "before", tone: "bad", text: `The photo is ${-minutes} min earlier than the time on the waybill: check the time.` });
    else if (minutes > ROAD_MAX_MIN) flags.push({ kind: "late", tone: "bad", text: `${minutes} min from the yard: over the ${ROAD_MAX_MIN} min it should take.` });
    else if (minutes < ROAD_TOO_QUICK_MIN)
      flags.push({ kind: "quick", tone: "check", text: `Only ${minutes} min from the yard (${ROAD_USUAL_MIN} with no traffic): was the waybill's time written late?` });
  } else if (t.reading !== "working") {
    flags.push({ kind: "notime", tone: "check", text: "No time from the waybill yet: type it in to check the road time." });
  }
  if (t.waybillDate && t.waybillDate !== t.day) flags.push({ kind: "date", tone: "check", text: `The waybill is dated ${shortDate(t.waybillDate)}, the truck came ${shortDate(t.day)}.` });
  // Its number as digits without leading zeros: "0026019" typed as "26019" is the same waybill.
  const key = (no: string | null) => no?.replace(/\D/g, "").replace(/^0+/, "") ?? "";
  const no = key(t.waybillNo);
  if (no) {
    const twin = all.find((o) => o.id !== t.id && key(o.waybillNo) === no);
    if (twin) flags.push({ kind: "twice", tone: "bad", text: `Waybill ${t.waybillNo} is in twice (also ${shortDate(twin.day)} ${clockOf(twin.arrivedAt)}).` });
  }
  if (t.mix) {
    if (day?.mix && !sameMix(t.mix, day.mix)) flags.push({ kind: "mix", tone: "bad", text: `Mix ${t.mix}: ${day.mix} was ordered.` });
    else if (!day?.mix) {
      const usual = usualMix(all.filter((o) => o.day === t.day));
      if (usual && !sameMix(t.mix, usual)) flags.push({ kind: "mix", tone: "bad", text: `Mix ${t.mix}: the other trucks brought ${usual}.` });
    }
  }
  return flags;
}

/** The checks a phone alert is sent for (a missing time is only shown on the page). */
export const alertFlags = (flags: Flag[]) => flags.filter((f) => f.kind !== "notime");

/** A day's trucks in the order they arrived. */
export const trucksOn = (all: readonly Truck[], day: string) => all.filter((t) => t.day === day).sort((a, b) => a.arrivedAt.localeCompare(b.arrivedAt));

export function daySummary(dayTrucks: readonly Truck[]) {
  const volume = dayTrucks.reduce((n, t) => n + (t.volume ?? 0), 0);
  const roads = dayTrucks.map(roadMinutes).filter((m): m is number => m !== null && m >= 0);
  return {
    trucks: dayTrucks.length,
    volume: Math.round(volume * 10) / 10,
    averageRoad: roads.length ? Math.round(roads.reduce((a, b) => a + b, 0) / roads.length) : null,
  };
}
