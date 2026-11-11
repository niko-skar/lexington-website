// The roll call's reminders (Niko, 11 Nov 2026: "3 reminders to go out and take the roll call monday to friday:
// 7:45 am, 12:58 pm after lunch, 16:45 pm end of day; saturday 7:45am and closing 2pm"): which one is due at a given
// moment. The roll call's own three checks are Morning, Afternoon and Closing; a Saturday has no afternoon one, it
// closes at 2. Ghana keeps GMT all year, so these are also the times in vercel.json. Kept apart from the sending so it
// can be checked on its own.

export type RollcallCheck = "morning" | "afternoon" | "closing";

export interface RollcallReminder {
  check: RollcallCheck;
  /** The Ghana day, YYYY-MM-DD. */
  day: string;
  title: string;
  body: string;
}

/** 0 Sunday ... 6 Saturday; the time as HH:MM. */
export const REMINDER_TIMES: ReadonlyArray<{ days: readonly number[]; at: string; check: RollcallCheck; title: string; body: string }> = [
  { days: [1, 2, 3, 4, 5, 6], at: "07:45", check: "morning", title: "Roll call: morning", body: "Time to go out and take the morning roll call." },
  { days: [1, 2, 3, 4, 5], at: "12:58", check: "afternoon", title: "Roll call: after lunch", body: "Lunch is over: go out and take the afternoon roll call." },
  { days: [1, 2, 3, 4, 5], at: "16:45", check: "closing", title: "Roll call: end of day", body: "Go out and take the closing roll call before everyone leaves." },
  { days: [6], at: "14:00", check: "closing", title: "Roll call: Saturday closing", body: "The site closes at 2: go out and take the closing roll call." },
];

/** A scheduled call can come a little late (never much early): it still counts this long after its time. */
export const LATE_MINUTES = 20;
const EARLY_MINUTES = 2;

/** The reminder due at this moment, or none (a Sunday, or any other time of day). */
export function reminderAt(now: Date): RollcallReminder | null {
  const weekday = now.getUTCDay();
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  for (const r of REMINDER_TIMES) {
    if (!r.days.includes(weekday)) continue;
    const at = Number(r.at.slice(0, 2)) * 60 + Number(r.at.slice(3));
    if (minutes >= at - EARLY_MINUTES && minutes <= at + LATE_MINUTES) return { check: r.check, day: now.toISOString().slice(0, 10), title: r.title, body: r.body };
  }
  return null;
}
