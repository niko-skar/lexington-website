// The calendar file for a booked visit ("Add to my calendar" on the booking page, and attached to the emails). Pure.

import { slotStartMs } from "./shared";

const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Lines longer than 75 bytes are folded, as the calendar format asks. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest, "utf8") > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut), "utf8") > 75) cut -= 1;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join("\r\n");
}

export function visitIcs({
  id,
  slot,
  location,
  description,
  url,
  nowMs = Date.now(),
}: {
  id: string;
  slot: string;
  location: string;
  description: string;
  url: string;
  nowMs?: number;
}): string {
  const start = slotStartMs(slot);
  if (start === null) throw new Error(`Not a visit time: ${slot}`);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//The Lexington//Site visits//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${id}@lexington.com.gh`,
    `DTSTAMP:${stamp(nowMs)}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(start + 3_600_000)}`,
    "SUMMARY:Site visit: The Lexington",
    `LOCATION:${escape(location)}`,
    `DESCRIPTION:${escape(description)}`,
    `URL:${url}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Site visit: The Lexington",
    "TRIGGER:-PT2H",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .map(fold)
    .join("\r\n")
    .concat("\r\n");
}
