"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { phoneHref, whatsappUrl } from "@/lib/format";
import {
  BOOKED_VIA,
  STATUS_LABEL,
  byDay,
  dayLabel,
  dayWord,
  rangeLabel,
  slotDay,
  slotLabel,
  slotStartMs,
  timeLabel,
  type SlotKey,
  type VisitRow,
  type VisitsData,
} from "@/lib/siteVisits/shared";
import type { TodoMe } from "@/lib/todo/shared";
import { AccessSheet } from "./AccessSheet";
import { errorText, send, startPolling } from "./api";
import { SiteHeader, SiteMenu } from "./SiteChrome";
import styles from "./Todo.module.css";
import v from "./Visits.module.css";

// Site visits (lib/siteVisits says what and why): who is coming and when, booked by the visitors themselves on the
// website or with the chat assistant. After a visit: Came (a follow-up step on their record) or Didn't come (they are
// emailed to pick another time). Move, cancel, add one booked by phone, and block hours Niko can't show anyone.

type ToastData = { text: string; tone?: "error"; link?: { label: string; url: string } };
type Answer = { ok: true; data: VisitsData; whatsapp?: string };
const EMPTY: VisitsData = { upcoming: [], past: [], blocked: [], open: [], now: new Date(0).toISOString() };
const HOUR = 3_600_000;
/** When a change was saved (the list then ignores an older answer still on its way). */
const stamp = () => Date.now();

export function VisitsApp({ me, active, initial, startedOffline, fresh }: { me: TodoMe; active: boolean; initial: VisitsData | null; startedOffline: boolean; fresh: boolean }) {
  const [data, setData] = useState<VisitsData>(initial ?? EMPTY);
  const [loaded, setLoaded] = useState(initial !== null);
  const [offline, setOffline] = useState(startedOffline);
  const [signedOut, setSignedOut] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ kind: "move" | "cancel"; visit: VisitRow } | { kind: "add" } | { kind: "block" } | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const inFlight = useRef(false);
  const lastLoadedAt = useRef(0);
  const localAt = useRef(0);
  const skipFirst = useRef(fresh);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showToast = useCallback((t: ToastData) => {
    clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), t.link ? 15000 : 6000);
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const startedAt = Date.now();
    try {
      const response = await fetch("/api/site-visits", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        setSignedOut(true);
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      const next = (await response.json()) as VisitsData;
      lastLoadedAt.current = Date.now();
      setLoaded(true);
      setOffline(false);
      if (startedAt >= localAt.current) setData(next);
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
    return startPolling(refresh, 60_000, 180_000);
  }, [active, refresh]);

  /** One change, then the list as the server has it. */
  const act = async (key: string, body: Record<string, unknown>, done: (answer: Answer) => ToastData): Promise<boolean> => {
    setBusy(key);
    try {
      const answer = await send<Answer>("/api/site-visits", "POST", body);
      localAt.current = stamp();
      setData(answer.data);
      showToast(done(answer));
      return true;
    } catch (e) {
      showToast({ text: errorText(e), tone: "error" });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const nowMs = Date.parse(data.now);
  const today = data.now.slice(0, 10);
  const days = useMemo(() => {
    const out: Array<{ day: string; visits: VisitRow[] }> = [];
    for (const x of data.upcoming) {
      const day = slotDay(x.slot);
      const last = out[out.length - 1];
      if (last?.day === day) last.visits.push(x);
      else out.push({ day, visits: [x] });
    }
    return out;
  }, [data.upcoming]);
  const todayCount = data.upcoming.filter((x) => slotDay(x.slot) === today).length;
  const toMark = [...data.upcoming, ...data.past].filter((x) => x.status === "booked" && (slotStartMs(x.slot) ?? 0) + HOUR <= nowMs);
  const sub = data.upcoming.length
    ? `${todayCount ? `${todayCount} today · ` : ""}${data.upcoming.length} coming${toMark.length ? ` · ${toMark.length} to mark` : ""}`
    : "No visits booked";

  const card = (x: VisitRow) => {
    const start = slotStartMs(x.slot) ?? 0;
    const started = start <= nowMs;
    const first = x.name.split(/\s+/)[0] || x.name;
    return (
      <article key={x.id} className={`${v.card} ${x.status !== "booked" ? v.cardDone : ""}`}>
        <div className={v.top}>
          <span className={v.time}>{timeLabel(x.slot)}</span>
          <span className={v.name}>{x.name}</span>
          <span className={`${v.status} ${v[`s_${x.status}`] ?? ""}`}>{STATUS_LABEL[x.status]}</span>
        </div>
        <p className={v.line}>
          {[x.people ? `${x.people} ${x.people === 1 ? "person" : "people"}` : "", x.interest && x.interest !== "Not sure yet" ? x.interest : "", `booked ${BOOKED_VIA[x.source]}`].filter(Boolean).join(" · ")}
        </p>
        {x.note && <p className={v.note}>&ldquo;{x.note}&rdquo;</p>}
        <p className={v.meta}>
          {x.phone && (
            <a href={phoneHref(x.phone)} className={v.link}>
              {x.phone}
            </a>
          )}
          {x.email && <span>{x.email}</span>}
          {x.status === "booked" && !started && (
            <span>{x.remindedAt ? (x.remindedBy === "booked-recently" ? "booked recently, no reminder needed" : `reminded (${x.remindedBy})`) : x.email || x.source !== "website" ? "reminder goes the day before" : "no email: remind by WhatsApp"}</span>
          )}
          {x.moves > 0 && <span>moved {x.moves === 1 ? "once" : `${x.moves} times`}</span>}
          {x.rebookSentAt && <span>asked to pick another time</span>}
        </p>
        <div className={v.buttons}>
          {x.status === "booked" && started ? (
            <>
              <button type="button" className={v.primary} disabled={busy !== null} onClick={() => void act(`came-${x.id}`, { action: "came", id: x.id }, () => ({ text: `${first} came: a follow-up step is on their record for tomorrow.` }))}>
                {busy === `came-${x.id}` ? "Saving…" : "Came"}
              </button>
              <button
                type="button"
                className={v.secondary}
                disabled={busy !== null}
                onClick={() =>
                  void act(`missed-${x.id}`, { action: "missed", id: x.id }, (a) => ({
                    text: x.email ? `${first} was emailed to pick another time.` : `${first} has no email: send them a WhatsApp to pick another time.`,
                    ...(a.whatsapp && { link: { label: `WhatsApp ${first}`, url: a.whatsapp } }),
                  }))
                }
              >
                {busy === `missed-${x.id}` ? "Saving…" : "Didn't come"}
              </button>
            </>
          ) : x.status === "booked" ? (
            <>
              <button type="button" className={v.secondary} disabled={busy !== null} onClick={() => setSheet({ kind: "move", visit: x })}>
                Move
              </button>
              <button type="button" className={v.secondary} disabled={busy !== null} onClick={() => setSheet({ kind: "cancel", visit: x })}>
                Cancel
              </button>
            </>
          ) : null}
          {x.phone && (
            <a className={v.secondary} href={whatsappUrl(x.phone)} target="_blank" rel="noopener noreferrer">
              WhatsApp
            </a>
          )}
          {x.leadId && (
            <a className={v.secondary} href={`/admin/crm/${x.leadId}`}>
              Record
            </a>
          )}
        </div>
      </article>
    );
  };

  return (
    <>
      <SiteHeader eyebrow="Sales" title="Site visits" sub={sub} onMenu={() => setMenuOpen(true)}>
        <div className={v.tools}>
          <button type="button" className={v.tool} onClick={() => setSheet({ kind: "add" })}>
            + Add a visit
          </button>
          <button type="button" className={v.tool} onClick={() => setSheet({ kind: "block" })}>
            Block times{data.blocked.length ? ` (${data.blocked.length})` : ""}
          </button>
          <a className={v.tool} href="/visit" target="_blank" rel="noopener noreferrer">
            Booking page
          </a>
        </div>
      </SiteHeader>
      {signedOut && (
        <div className={styles.banner} role="alert">
          You&rsquo;ve been signed out. <a href="/todo/visits">Sign in again</a>
        </div>
      )}
      {offline && !signedOut && (
        <div className={styles.banner} role="status">
          No signal: showing the visits as they were.
        </div>
      )}

      <main className={styles.main}>
        {!loaded ? (
          <p className={styles.loading}>Loading the visits…</p>
        ) : (
          <>
            {toMark.filter((x) => slotDay(x.slot) < today).length > 0 && (
              <section className={v.section}>
                <h2 className={v.dayTitle}>To mark: did they come?</h2>
                {toMark.filter((x) => slotDay(x.slot) < today).map(card)}
              </section>
            )}
            {days.length === 0 ? (
              <p className={styles.empty}>No visits booked yet. Visitors book on the booking page, and the chat assistant books them in Messenger and Instagram.</p>
            ) : (
              days.map((d) => (
                <section key={d.day} className={v.section}>
                  <h2 className={v.dayTitle}>
                    {dayWord(d.day, nowMs) ? `${dayWord(d.day, nowMs).replace(/^./, (c) => c.toUpperCase())} · ` : ""}
                    {dayLabel(d.day)}
                  </h2>
                  {d.visits.map(card)}
                </section>
              ))
            )}
            {data.past.filter((x) => !(x.status === "booked" && slotDay(x.slot) < today)).length > 0 && (
              <section className={v.section}>
                <h2 className={v.dayTitle}>Earlier (30 days)</h2>
                <ul className={v.past}>
                  {data.past
                    .filter((x) => !(x.status === "booked" && slotDay(x.slot) < today))
                    .map((x) => (
                      <li key={x.id}>
                        <span>
                          {slotLabel(x.slot, true)} · <b>{x.name}</b>
                        </span>
                        <span className={`${v.status} ${v[`s_${x.status}`] ?? ""}`}>{STATUS_LABEL[x.status]}</span>
                      </li>
                    ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>

      {sheet?.kind === "cancel" && (
        <div className={styles.sheetBackdrop}>
          <div className={styles.sheet} role="dialog" aria-label="Cancel a visit">
            <h2 className={styles.sheetTitle}>Cancel {sheet.visit.name}&rsquo;s visit?</h2>
            <p className={styles.sheetNote}>
              {dayLabel(slotDay(sheet.visit.slot))}, {rangeLabel(sheet.visit.slot)}. The hour is free again, and{" "}
              {sheet.visit.email ? `${sheet.visit.email} gets an email asking them to pick another time.` : "you get a WhatsApp message to send them."}
            </p>
            <div className={styles.sheetButtons}>
              <button type="button" className={styles.sheetCancel} onClick={() => setSheet(null)} disabled={busy !== null}>
                Keep it
              </button>
              <button
                type="button"
                className={styles.sheetSave}
                disabled={busy !== null}
                onClick={async () => {
                  const x = sheet.visit;
                  const first = x.name.split(/\s+/)[0] || x.name;
                  const ok = await act(`cancel-${x.id}`, { action: "cancel", id: x.id }, (a) => ({
                    text: x.email ? `Cancelled. ${first} was emailed to pick another time.` : `Cancelled. Send ${first} a WhatsApp so they know.`,
                    ...(a.whatsapp && { link: { label: `WhatsApp ${first}`, url: a.whatsapp } }),
                  }));
                  if (ok) setSheet(null);
                }}
              >
                {busy ? "Cancelling…" : "Cancel the visit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {sheet?.kind === "move" && (
        <SlotSheet
          title={`Move ${sheet.visit.name}'s visit`}
          note={`Now ${slotLabel(sheet.visit.slot)}. ${sheet.visit.email ? "They get an email with the new time." : "Tell them the new time on WhatsApp."}`}
          free={freeFrom(data)}
          nowMs={nowMs}
          saveLabel="Move it"
          busy={busy !== null}
          onClose={() => setSheet(null)}
          onSave={async (slot) => {
            const ok = await act(`move-${sheet.visit.id}`, { action: "move", id: sheet.visit.id, slot }, () => ({ text: `Moved to ${slotLabel(slot)}.` }));
            if (ok) setSheet(null);
          }}
        />
      )}

      {sheet?.kind === "add" && <AddSheet data={data} nowMs={nowMs} busy={busy !== null} onClose={() => setSheet(null)} onSave={async (body, name) => {
        const ok = await act("add", { action: "add", ...body }, (a) => ({
          text: `${name}'s visit is booked.${body.email ? " A confirmation went to their email." : ""}`,
          ...(a.whatsapp && { link: { label: "WhatsApp the confirmation", url: a.whatsapp } }),
        }));
        if (ok) setSheet(null);
      }} />}

      {sheet?.kind === "block" && (
        <BlockSheet
          data={data}
          nowMs={nowMs}
          busy={busy !== null}
          onClose={() => setSheet(null)}
          onChange={(slots, block) =>
            void act(block ? "block" : "unblock", { action: block ? "block" : "unblock", slots }, () => ({
              text: block ? `${slots.length === 1 ? "That hour is" : `${slots.length} hours are`} blocked: nobody can book ${slots.length === 1 ? "it" : "them"}.` : "Free to book again.",
            }))
          }
        />
      )}

      {menuOpen && <SiteMenu me={me} onClose={() => setMenuOpen(false)} onRefresh={() => void refresh()} onLogins={() => setAccessOpen(true)} />}
      {accessOpen && <AccessSheet onClose={() => setAccessOpen(false)} />}
      {toast && (
        <div className={`${styles.toast} ${toast.tone === "error" ? styles.toastError : ""}`} role="status">
          <span>{toast.text}</span>
          {toast.link && (
            <a className={v.toastLink} href={toast.link.url} target="_blank" rel="noopener noreferrer" onClick={() => setToast(null)}>
              {toast.link.label}
            </a>
          )}
        </div>
      )}
    </>
  );
}

/** The hours nobody has booked or blocked (the office may book from the next hour on). */
function freeFrom(data: VisitsData): SlotKey[] {
  const taken = new Set([...data.upcoming.filter((x) => x.status === "booked").map((x) => x.slot), ...data.blocked]);
  return data.open.filter((k) => !taken.has(k));
}

/* ---------- pick an hour ---------- */

function HourPicker({ free, nowMs, value, onChange }: { free: SlotKey[]; nowMs: number; value: string; onChange: (slot: SlotKey) => void }) {
  const days = byDay(free);
  const [day, setDay] = useState(value ? slotDay(value) : days[0]?.day ?? "");
  const shown = days.find((d) => d.day === day) ?? days[0];
  if (!days.length) return <p className={styles.sheetNote}>No free hours in the next three weeks.</p>;
  return (
    <>
      <div className={v.dayChips}>
        {days.map((d) => (
          <button key={d.day} type="button" className={d.day === shown?.day ? styles.chipOn : styles.chip} aria-pressed={d.day === shown?.day} onClick={() => setDay(d.day)}>
            {dayWord(d.day, nowMs) || dayLabel(d.day, true)}
          </button>
        ))}
      </div>
      {shown && (
        <div className={styles.chips}>
          {shown.slots.map((k) => (
            <button key={k} type="button" className={value === k ? styles.chipOn : styles.chip} aria-pressed={value === k} onClick={() => onChange(k)}>
              {timeLabel(k)}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function SlotSheet({
  title,
  note,
  free,
  nowMs,
  saveLabel,
  busy,
  onClose,
  onSave,
}: {
  title: string;
  note: string;
  free: SlotKey[];
  nowMs: number;
  saveLabel: string;
  busy: boolean;
  onClose: () => void;
  onSave: (slot: SlotKey) => Promise<void>;
}) {
  const [slot, setSlot] = useState("");
  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label={title}>
        <h2 className={styles.sheetTitle}>{title}</h2>
        <p className={styles.sheetNote}>{note}</p>
        <HourPicker free={free} nowMs={nowMs} value={slot} onChange={setSlot} />
        {slot && <p className={styles.sheetNote}>New time: {slotLabel(slot)}</p>}
        <div className={styles.sheetButtons}>
          <button type="button" className={styles.sheetCancel} onClick={onClose} disabled={busy}>
            Back
          </button>
          <button type="button" className={styles.sheetSave} onClick={() => slot && void onSave(slot)} disabled={busy || !slot}>
            {busy ? "Saving…" : saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- a visit booked by phone ---------- */

function AddSheet({
  data,
  nowMs,
  busy,
  onClose,
  onSave,
}: {
  data: VisitsData;
  nowMs: number;
  busy: boolean;
  onClose: () => void;
  onSave: (body: { slot: string; name: string; phone: string; email: string; people: number | null; note: string }, name: string) => Promise<void>;
}) {
  const [slot, setSlot] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [people, setPeople] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const save = () => {
    if (!slot) return setError("Pick a time.");
    if (name.trim().length < 2) return setError("Type their name.");
    if (phone.replace(/\D/g, "").length < 7) return setError("Type their phone or WhatsApp number.");
    setError("");
    void onSave({ slot, name: name.trim(), phone: phone.trim(), email: email.trim(), people: Number(people) || null, note: note.trim() }, name.trim().split(/\s+/)[0]);
  };
  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label="Add a visit">
        <h2 className={styles.sheetTitle}>Add a visit</h2>
        <p className={styles.sheetNote}>Someone who called or messaged you. With an email they get the confirmation and the reminder.</p>
        <HourPicker free={freeFrom(data)} nowMs={nowMs} value={slot} onChange={setSlot} />
        <label className={styles.label} htmlFor="sv-name">
          Name
        </label>
        <input id="sv-name" className={styles.input} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} autoComplete="off" />
        <label className={styles.label} htmlFor="sv-phone">
          Phone or WhatsApp
        </label>
        <input id="sv-phone" className={styles.input} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} placeholder="+233…" />
        <label className={styles.label} htmlFor="sv-email">
          Email (optional)
        </label>
        <input id="sv-email" className={styles.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
        <label className={styles.label} htmlFor="sv-people">
          How many (optional)
        </label>
        <input id="sv-people" className={styles.input} inputMode="numeric" value={people} onChange={(e) => setPeople(e.target.value.replace(/\D/g, "").slice(0, 2))} disabled={busy} />
        <label className={styles.label} htmlFor="sv-note">
          Note (optional)
        </label>
        <input id="sv-note" className={styles.input} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} maxLength={300} />
        {error && <p className={styles.sheetError}>{error}</p>}
        <div className={styles.sheetButtons}>
          <button type="button" className={styles.sheetCancel} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={styles.sheetSave} onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Book it"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- hours Niko can't show anyone ---------- */

function BlockSheet({ data, nowMs, busy, onClose, onChange }: { data: VisitsData; nowMs: number; busy: boolean; onClose: () => void; onChange: (slots: SlotKey[], block: boolean) => void }) {
  const days = byDay(data.open);
  const [day, setDay] = useState(days[0]?.day ?? "");
  const shown = days.find((d) => d.day === day) ?? days[0];
  const blocked = new Set(data.blocked);
  const booked = new Map(data.upcoming.filter((x) => x.status === "booked").map((x) => [x.slot, x.name]));
  const freeThatDay = shown ? shown.slots.filter((k) => !blocked.has(k) && !booked.has(k)) : [];
  const blockedThatDay = shown ? shown.slots.filter((k) => blocked.has(k)) : [];
  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label="Block times">
        <h2 className={styles.sheetTitle}>Block times</h2>
        <p className={styles.sheetNote}>Hours you can&rsquo;t show anyone. Tap an hour to block it or free it again; booked hours stay booked.</p>
        <div className={v.dayChips}>
          {days.map((d) => {
            const n = d.slots.filter((k) => blocked.has(k)).length;
            return (
              <button key={d.day} type="button" className={d.day === shown?.day ? styles.chipOn : styles.chip} aria-pressed={d.day === shown?.day} onClick={() => setDay(d.day)}>
                {dayWord(d.day, nowMs) || dayLabel(d.day, true)}
                {n ? ` (${n})` : ""}
              </button>
            );
          })}
        </div>
        {shown && (
          <>
            <div className={v.hours}>
              {shown.slots.map((k) => {
                const who = booked.get(k);
                const isBlocked = blocked.has(k);
                return (
                  <button
                    key={k}
                    type="button"
                    className={`${v.hour} ${isBlocked ? v.hourBlocked : who ? v.hourBooked : ""}`}
                    disabled={busy || Boolean(who)}
                    onClick={() => onChange([k], !isBlocked)}
                  >
                    <b>{timeLabel(k)}</b>
                    <span>{who ? who.split(/\s+/)[0] : isBlocked ? "Blocked" : "Free"}</span>
                  </button>
                );
              })}
            </div>
            <div className={styles.sheetButtons}>
              <button type="button" className={styles.sheetCancel} disabled={busy || !blockedThatDay.length} onClick={() => onChange(blockedThatDay, false)}>
                Free the whole day
              </button>
              <button type="button" className={styles.sheetSave} disabled={busy || !freeThatDay.length} onClick={() => onChange(freeThatDay, true)}>
                Block the whole day
              </button>
            </div>
          </>
        )}
        <button type="button" className={styles.sheetCancel} onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
