"use client";

import { dayOf, when } from "@/lib/asbuilt/format";
import { getAt, sameValue } from "@/lib/asbuilt/paths";
import type { Floor, LogEntry } from "@/lib/asbuilt/types";

import s from "./AsBuilt.module.css";

interface Props {
  floor: Floor;
  busy: boolean;
  onUndo: (entry: LogEntry) => void;
}

interface Stored {
  path: string;
  before: unknown;
  after: unknown;
}

export function parseChanges(entry: LogEntry): Stored[] {
  try {
    const list = JSON.parse(entry.changes ?? "[]");
    return Array.isArray(list) ? (list as Stored[]) : [];
  } catch {
    return [];
  }
}

/** Only while nothing it touched has changed again since (and it hasn't been undone already). */
export function canUndo(floor: Floor, entry: LogEntry): boolean {
  const changes = parseChanges(entry);
  if (!changes.length) return false;
  if ((floor.log ?? []).some((l) => l.undoOf === entry._key)) return false;
  return changes.every((c) => sameValue(getAt(floor, c.path), c.after));
}

export function HistoryView({ floor, busy, onUndo }: Props) {
  const entries = [...(floor.log ?? [])].reverse();
  if (!entries.length) {
    return (
      <div className={s.empty}>
        Nothing recorded on the {floor.name} yet. Every measurement you save shows up here, with the time.
      </div>
    );
  }
  // Grouped by day, newest first.
  const days: { day: string; entries: LogEntry[] }[] = [];
  for (const entry of entries) {
    const day = dayOf(entry.at);
    const last = days[days.length - 1];
    if (last && last.day === day) last.entries.push(entry);
    else days.push({ day, entries: [entry] });
  }
  return (
    <div>
      <p className={s.hint} style={{ marginBottom: 6 }}>
        Newest first. Undo puts back what was there before that change.
      </p>
      {days.map(({ day, entries: list }) => (
        <section key={day}>
          <h3 className={s.historyDay}>{day}</h3>
          <ul className={s.history}>
            {list.map((entry) => (
              <li key={entry._key} className={s.historyItem}>
                <time dateTime={entry.at}>{when(entry.at).split(", ")[1]}</time>
                <span>{entry.text}</span>
                {canUndo(floor, entry) ? (
                  <button
                    type="button"
                    className={`${s.btn} ${s.btnSmall}`}
                    disabled={busy}
                    onClick={() => onUndo(entry)}
                  >
                    Undo
                  </button>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {(floor.log?.length ?? 0) >= 300 && (
        <p className={s.hint}>Showing the latest 300 changes. The download has them all.</p>
      )}
    </div>
  );
}
