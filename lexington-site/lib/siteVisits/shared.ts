// Site visits booked by the visitors themselves (Niko, 7 Nov 2026: "how can we automate this so site visits are
// being booked automatically?"; his answers: "monday to saturday 8am to 6pm", he shows them himself, and "All of it":
// the booking page, the assistant booking in the chats, the link everywhere, his alerts and the reminders).
//
// A visit is one hour. Accra keeps UTC all year (no daylight saving), so a slot's hour is the same number in UTC and
// in Accra, and every date here is worked out in UTC. A slot is written "2026-11-13T10" (10:00 to 11:00, Accra).
//
// Pure: the booking page, the site app, the chat assistant and the tests all use it.

/** Monday to Saturday (as Date.getUTCDay counts them). */
export const VISIT_WEEKDAYS = [1, 2, 3, 4, 5, 6] as const;
/** The first visit starts at 08:00 and the last at 17:00, so every visit is over by 18:00. */
export const FIRST_HOUR = 8;
export const LAST_START_HOUR = 17;
/** No visit can be booked to start sooner than this (Niko has to be there). */
export const MIN_NOTICE_MS = 3 * 3_600_000;
/** How far ahead visits can be booked. */
export const BOOK_AHEAD_DAYS = 21;

const HOUR = 3_600_000;
const DAY = 86_400_000;

export type SlotKey = string;
export const SLOT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})$/;

export type VisitStatus = "booked" | "came" | "missed" | "cancelled";
export const VISIT_STATUSES: readonly VisitStatus[] = ["booked", "came", "missed", "cancelled"];

/** Where the visit was booked. */
export type VisitSource = "website" | "messenger" | "instagram" | "whatsapp" | "office";
/** "Booked on the website", "booked in a Messenger chat", "booked by the office". */
export const BOOKED_VIA: Record<VisitSource, string> = {
  website: "on the website",
  messenger: "in a Messenger chat",
  instagram: "in an Instagram chat",
  whatsapp: "in a WhatsApp chat",
  office: "by the office",
};

/**
 * Where visitors go, for short messages (a WhatsApp note, a chat reminder): Site settings' office address
 * ("18 Duala Close — Opposite Oak Plaza Hotel East Legon, Shiashie", checked 11 Nov 2026) in a sentence's words.
 * Emails and pages use the Site settings field itself.
 */
export const VISIT_PLACE = "18 Duala Close, opposite Oak Plaza Hotel, East Legon";

/** What they would like to see (the booking page's choices; "" when they don't say). */
export const VISIT_INTERESTS = ["One bedroom", "Two bedrooms", "Three bedrooms", "Penthouse", "Not sure yet"] as const;

const pad = (n: number) => String(n).padStart(2, "0");

/** The slot an instant falls in (its hour, Accra time). */
export function slotKey(ms: number): SlotKey {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}`;
}

/** When a slot starts, or null when it isn't a real slot ("2026-02-30T10" isn't). */
export function slotStartMs(key: string): number | null {
  const m = SLOT_RE.exec(key);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]));
  return slotKey(ms) === key ? ms : null;
}

/** A slot inside the visiting hours: Monday to Saturday, starting 08:00 to 17:00. */
export function isVisitingHour(key: string): boolean {
  const ms = slotStartMs(key);
  if (ms === null) return false;
  const d = new Date(ms);
  return (VISIT_WEEKDAYS as readonly number[]).includes(d.getUTCDay()) && d.getUTCHours() >= FIRST_HOUR && d.getUTCHours() <= LAST_START_HOUR;
}

/**
 * A slot someone may book now: in the visiting hours, at least `notice` away (MIN_NOTICE_MS for a visitor; the office
 * books someone on the phone for the next hour) and within BOOK_AHEAD_DAYS.
 */
export function bookable(key: string, nowMs: number, notice = MIN_NOTICE_MS): boolean {
  const ms = slotStartMs(key);
  return ms !== null && isVisitingHour(key) && ms >= nowMs + notice && ms <= nowMs + BOOK_AHEAD_DAYS * DAY;
}

/** Every slot in the visiting hours from now on (with the notice) for `days` days, earliest first. */
export function openSlots(nowMs: number, days = BOOK_AHEAD_DAYS, notice = MIN_NOTICE_MS): SlotKey[] {
  const out: SlotKey[] = [];
  const first = Math.ceil((nowMs + notice) / HOUR) * HOUR;
  const last = nowMs + Math.min(days, BOOK_AHEAD_DAYS) * DAY;
  for (let ms = first; ms <= last; ms += HOUR) {
    const key = slotKey(ms);
    if (isVisitingHour(key)) out.push(key);
  }
  return out;
}

/** The open slots nobody has taken (or Niko blocked). */
export function freeSlots(nowMs: number, taken: ReadonlySet<string>, days = BOOK_AHEAD_DAYS): SlotKey[] {
  return openSlots(nowMs, days).filter((k) => !taken.has(k));
}

/** "2026-11-13" */
export const slotDay = (key: SlotKey) => key.slice(0, 10);
/** 10 */
export const slotHour = (key: SlotKey) => Number(key.slice(11, 13));

/** The slots by day, in order. */
export function byDay(keys: readonly SlotKey[]): Array<{ day: string; slots: SlotKey[] }> {
  const out: Array<{ day: string; slots: SlotKey[] }> = [];
  for (const key of keys) {
    const day = slotDay(key);
    const last = out[out.length - 1];
    if (last?.day === day) last.slots.push(key);
    else out.push({ day, slots: [key] });
  }
  return out;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const dayDate = (day: string) => new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))));

/** "Thursday 13 November" (or "Thu 13 Nov" when short). */
export function dayLabel(day: string, short = false): string {
  const d = dayDate(day);
  const weekday = WEEKDAYS[d.getUTCDay()];
  const month = MONTHS[d.getUTCMonth()];
  return short ? `${weekday.slice(0, 3)} ${d.getUTCDate()} ${month.slice(0, 3)}` : `${weekday} ${d.getUTCDate()} ${month}`;
}

/** "10:00" */
export const timeLabel = (key: SlotKey) => `${key.slice(11, 13)}:00`;
/** "10:00 to 11:00" */
export const rangeLabel = (key: SlotKey) => `${timeLabel(key)} to ${pad(slotHour(key) + 1)}:00`;
/** "Thursday 13 November at 10:00" */
export const slotLabel = (key: SlotKey, short = false) => `${dayLabel(slotDay(key), short)} at ${timeLabel(key)}`;

/** "today", "tomorrow" or "" for a day, seen from `nowMs`. */
export function dayWord(day: string, nowMs: number): string {
  const today = slotKey(nowMs).slice(0, 10);
  if (day === today) return "today";
  if (day === slotKey(nowMs + DAY).slice(0, 10)) return "tomorrow";
  return "";
}

/**
 * A time the chat assistant picked ("2026-11-13 10:00", "2026-11-13T10:00" or "2026-11-13T10"), as a slot,
 * or null when it isn't one.
 */
export function slotFromText(text: string): SlotKey | null {
  const m = /^\s*(\d{4}-\d{2}-\d{2})[T\s](\d{1,2})(?::00)?\s*$/.exec(text);
  if (!m) return null;
  const key = `${m[1]}T${pad(Number(m[2]))}`;
  return slotStartMs(key) === null ? null : key;
}

/**
 * The free times for the chat assistant's facts, a line per day for the next `days` days:
 * "- Thursday 13 November (2026-11-13): 08:00, 09:00, 11:00".
 */
export function freeTimesText(free: readonly SlotKey[], nowMs: number, days = 7): string[] {
  const until = slotKey(nowMs + days * DAY).slice(0, 10);
  return byDay(free)
    .filter((d) => d.day <= until)
    .map((d) => {
      const word = dayWord(d.day, nowMs);
      return `- ${dayLabel(d.day)}${word ? `, ${word}` : ""} (${d.day}): ${d.slots.map(timeLabel).join(", ")}`;
    });
}

/** The hours offered first: mid-morning, then early afternoon, then the rest. */
const GOOD_HOURS = [10, 11, 14, 9, 15, 12, 16, 13, 8, 17];

/**
 * Two free hours to offer someone (the chat's follow-up, 12 Nov 2026): a good hour on the first day with any from
 * tomorrow on, and one on the Saturday after it within the week (else on the next day with any). Pure.
 */
export function twoFreeTimes(free: readonly SlotKey[], nowMs: number): SlotKey[] {
  const tomorrow = slotKey(nowMs + DAY).slice(0, 10);
  const weekOut = slotKey(nowMs + 7 * DAY).slice(0, 10);
  const days = byDay(free.filter((k) => slotDay(k) >= tomorrow));
  if (!days.length) return [];
  const good = (slots: SlotKey[]) => GOOD_HOURS.map((h) => slots.find((k) => slotHour(k) === h)).find((k) => k !== undefined) ?? slots[0];
  const saturday = (day: string) => dayDate(day).getUTCDay() === 6;
  const second = days.slice(1).find((d) => saturday(d.day) && d.day <= weekOut) ?? days[1];
  return second ? [good(days[0].slots), good(second.slots)] : [good(days[0].slots)];
}

// ---- the site app's list ------------------------------------------------------------------------------

export interface VisitRow {
  id: string;
  slot: SlotKey;
  name: string;
  phone: string;
  email: string;
  people: number | null;
  interest: string;
  note: string;
  source: VisitSource;
  leadId: string | null;
  status: VisitStatus;
  createdAt: string;
  /** The reminder the day before went out (and how). */
  remindedAt: string | null;
  remindedBy: string | null;
  /** When it was marked came / missed / cancelled. */
  outcomeAt: string | null;
  /** The "sorry we missed you, pick another time" email went out. */
  rebookSentAt: string | null;
  /** How often its time was changed. */
  moves: number;
}

export interface VisitsData {
  /** Booked and still to come (today's included), earliest first. */
  upcoming: VisitRow[];
  /** The last 30 days' visits whose time has passed, latest first. */
  past: VisitRow[];
  /** Slots Niko took out (away, busy), from today on. */
  blocked: SlotKey[];
  /** What visitors can book now, for the "Block a time" sheet. */
  open: SlotKey[];
  now: string;
}

export const STATUS_LABEL: Record<VisitStatus, string> = {
  booked: "Booked",
  came: "Came",
  missed: "Didn't come",
  cancelled: "Cancelled",
};
