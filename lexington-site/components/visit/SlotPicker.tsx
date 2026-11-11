"use client";

import { useEffect, useMemo, useState } from "react";

import { byDay, dayLabel, dayWord, rangeLabel, slotDay, slotStartMs, timeLabel, type SlotKey } from "@/lib/siteVisits/shared";
import f from "../ReserveForm.module.css";
import s from "./Visit.module.css";

/**
 * Pick a day, then an hour (the booking page and the visitor's own page). Only free hours are shown; times are Accra's
 * (GMT), and a visitor abroad is told what that is where they are.
 */
export function SlotPicker({
  free,
  value,
  onChange,
  nowMs,
  error,
}: {
  free: SlotKey[];
  value: string;
  onChange: (slot: SlotKey) => void;
  /** The server's clock when the page was made (for "today" and "tomorrow"). */
  nowMs: number;
  error?: string;
}) {
  const days = useMemo(() => byDay(free), [free]);
  const [day, setDay] = useState<string>(() => (value ? slotDay(value) : days[0]?.day ?? ""));
  const shown = days.find((d) => d.day === day) ?? days[0];

  // The day of a time picked elsewhere (an "other free times" button) comes into view.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follows a choice made outside this picker
    if (value && slotDay(value) !== day) setDay(slotDay(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the chosen time changes
  }, [value]);

  // What the chosen hour is where the visitor is (only worked out in the browser).
  const [local, setLocal] = useState("");
  useEffect(() => {
    const start = value ? slotStartMs(value) : null;
    if (start === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the visitor's own clock can only be read in the browser
      setLocal("");
      return;
    }
    try {
      const offset = new Date(start).getTimezoneOffset();
      if (offset === 0) {
        setLocal("");
        return;
      }
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone?.replace(/_/g, " ") ?? "";
      const when = new Intl.DateTimeFormat(undefined, { weekday: "long", hour: "numeric", minute: "2-digit" }).format(new Date(start));
      setLocal(`That's ${when} where you are${zone ? ` (${zone})` : ""}.`);
    } catch {
      setLocal("");
    }
  }, [value]);

  if (!days.length) {
    return <p className={f.formError}>There are no free times to book online just now. Please call or WhatsApp us and we&rsquo;ll find one.</p>;
  }

  return (
    <div>
      <div className={s.days} role="radiogroup" aria-label="Day">
        {days.map((d) => {
          const word = dayWord(d.day, nowMs);
          const label = dayLabel(d.day, true).split(" ");
          return (
            <button
              key={d.day}
              type="button"
              role="radio"
              aria-checked={d.day === shown?.day}
              className={`${s.day} ${d.day === shown?.day ? s.dayOn : ""}`}
              onClick={() => setDay(d.day)}
            >
              <span className={s.dayName}>{word || label[0]}</span>
              <span className={s.dayNum}>{label[1]}</span>
              <span className={s.dayMonth}>{label[2]}</span>
            </button>
          );
        })}
      </div>

      {shown && (
        <fieldset className={s.timesBox}>
          <legend className={f.groupLabel}>
            {dayLabel(shown.day)} <em>· Accra time (GMT)</em>
          </legend>
          <div className={s.times}>
            {shown.slots.map((k) => (
              <label key={k} className={`${f.choice} ${s.time} ${value === k ? f.choiceOn : ""}`}>
                <input type="radio" name="slot-pick" value={k} checked={value === k} onChange={() => onChange(k)} />
                {timeLabel(k)}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {value && (
        <p className={s.chosen}>
          Your visit: <strong>{dayLabel(slotDay(value))}, {rangeLabel(value)}</strong>
          {local && <span className={s.local}> {local}</span>}
        </p>
      )}
      {error && (
        <p className={f.fieldError} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
