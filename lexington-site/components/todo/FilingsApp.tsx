"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { money } from "@/lib/expenses/shared";
import type { FilingsPage } from "@/lib/filings/server";
import { daysBetween, MONTH_RE, monthName, nextMonth, prevMonth, ruleById, SETUP, sheetCsv, WHT_WORDS, type Company, type DueItem, type FormKind, type Rule, type Sheet, type Staff, type WhtType } from "@/lib/filings/shared";
import type { TodoMe } from "@/lib/todo/shared";
import { AccessSheet } from "./AccessSheet";
import { errorText, send, startPolling } from "./api";
import fs from "./Filings.module.css";
import fin from "./Finance.module.css";
import { SiteHeader, SiteMenu } from "./SiteChrome";
import styles from "./Todo.module.css";

// Tax & filings (lib/filings/shared.ts says what and why): the company's one-off set-up with a tick each, the returns
// coming up (the late ones first, then the soonest) with what to pay when the figures are worked out, the year ahead,
// what's been filed, the company's details and the dates things start. A return opens its sheet: when, why, how, the
// figures (any month, earlier ones as practice), a CSV for Excel or the accountant, and "Filed".

type ToastData = { text: string; tone?: "error" };
type Save = (body: Record<string, unknown>, text: string) => Promise<void>;
type SheetState =
  | { kind: "item"; key: string }
  | { kind: "setup"; id: string }
  | { kind: "form"; form: FormKind; period: string; back: string | null }
  | { kind: "dates" }
  | { kind: "company" }
  | { kind: "staff" };

const FORM_NAMES: Record<FormKind, string> = { vat: "VAT return", paye: "PAYE", wht: "Withholding tax", ssnit: "SSNIT" };
const dayDate = (day: string) => new Date(`${day}T12:00:00Z`);
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_WORDS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "Today", "Tomorrow", "Fri 15 Jan", "Fri 15 Jan 2027" (another year). */
const dayWords = (day: string, today: string) => {
  if (day === today) return "Today";
  const d = dayDate(day);
  if (d.getTime() - dayDate(today).getTime() === 86_400_000) return "Tomorrow";
  return `${WEEKDAYS[d.getUTCDay()].slice(0, 3)} ${d.getUTCDate()} ${MONTH_WORDS[d.getUTCMonth()].slice(0, 3)}${day.slice(0, 4) !== today.slice(0, 4) ? ` ${day.slice(0, 4)}` : ""}`;
};
/** "Friday 15 January 2027". */
const longDay = (day: string) => {
  const d = dayDate(day);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_WORDS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const inDays = (days: number) => (days === 0 ? "today" : days === 1 ? "tomorrow" : days > 0 ? `in ${days} days` : `${-days} ${days === -1 ? "day" : "days"} late`);
const toNumber = (s: string) => {
  const n = parseFloat(s.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

export function FilingsApp({
  me,
  active,
  initial,
  startedOffline,
  fresh,
  tabs,
  open,
}: {
  me: TodoMe;
  active: boolean;
  initial: FilingsPage | null;
  startedOffline: boolean;
  fresh: boolean;
  tabs?: React.ReactNode;
  /** Opened from a phone alert: the return ("vat:2026-12") or set-up task ("bank") to show. */
  open?: string;
}) {
  const [data, setData] = useState<FilingsPage | null>(initial);
  const [offline, setOffline] = useState(startedOffline);
  const [signedOut, setSignedOut] = useState(false);
  const [sheet, setSheet] = useState<SheetState | null>(() =>
    !open ? null : initial?.items.some((i) => i.key === open) ? { kind: "item", key: open } : SETUP.some((r) => r.id === open) ? { kind: "setup", id: open } : null
  );
  const [toast, setToast] = useState<ToastData | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [showLater, setShowLater] = useState(false);
  const [showFiled, setShowFiled] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const inFlight = useRef(false);
  const lastLoadedAt = useRef(0);
  /** Bumped by each save: a load that started before it doesn't overwrite what the save answered. */
  const saves = useRef(0);
  const skipFirst = useRef(fresh);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showToast = useCallback((t: ToastData) => {
    clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const startedAt = saves.current;
    try {
      const response = await fetch("/api/filings", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        setSignedOut(true);
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      const next = (await response.json()) as FilingsPage;
      lastLoadedAt.current = Date.now();
      setOffline(false);
      if (startedAt === saves.current) setData(next);
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
    return startPolling(refresh, 300_000, 600_000);
  }, [active, refresh]);

  // Opened from a phone alert (/todo/filings?open=vat:2026-12): its sheet is open already; the address drops the link's
  // part so a reload doesn't open it again.
  useEffect(() => {
    if (open && window.location.search) window.history.replaceState(null, "", "/todo/filings");
  }, [open]);

  const save: Save = async (body, text) => {
    const next = await send<FilingsPage>("/api/filings", "POST", body);
    saves.current += 1;
    setData(next);
    showToast({ text });
  };

  const today = data?.today ?? new Date().toISOString().slice(0, 10);
  const items = useMemo(() => data?.items ?? [], [data]);
  const late = items.filter((i) => i.status === "late");
  const soon = items.filter((i) => i.status === "due");
  const later = items.filter((i) => i.status === "later");
  const filed = items.filter((i) => i.record).sort((a, b) => b.by.localeCompare(a.by));
  const setupRules = SETUP.map((rule) => ({ rule, done: data?.settings.setup[rule.id] ?? null }));
  const setupOpen = setupRules.filter((x) => !x.done);
  const setupDone = setupRules.filter((x) => x.done);
  // The next thing to do: a set-up task or a return, whichever is sooner.
  const nextSetup = setupOpen.filter((x) => x.rule.by).sort((a, b) => a.rule.by!.localeCompare(b.rule.by!))[0] ?? null;
  const nextItem = [...soon, ...later][0] ?? null;
  const next =
    nextSetup && (!nextItem || nextSetup.rule.by! < nextItem.by) ? { name: nextSetup.rule.name, by: nextSetup.rule.by! } : nextItem ? { name: nextItem.title, by: nextItem.by } : null;
  const lastMonth = prevMonth(today.slice(0, 7));

  const sub = !data ? "Loading…" : late.length ? `${late.length} late` : next ? `Next: ${next.name.split(" · ")[0]}, ${dayWords(next.by, today)}` : "Nothing due";

  const tick = async (rule: Rule, done: boolean) => {
    try {
      await save({ action: "setup", id: rule.id, done }, done ? `Done: ${rule.name}` : `Back on the list: ${rule.name}`);
    } catch (e) {
      showToast({ text: errorText(e), tone: "error" });
    }
  };

  const row = (i: DueItem) => (
    <button key={i.key} type="button" className={fin.item} onClick={() => setSheet({ kind: "item", key: i.key })}>
      <span className={fin.itemText}>
        <b>{i.title}</b>
        <small>
          {i.who} · {i.record ? `${i.record.status === "skipped" ? "not needed" : "filed"} ${dayWords(i.record.on, today)}` : `by ${dayWords(i.by, today)}, ${inDays(i.days)}`}
          {!i.sure && !i.record ? " · check" : ""}
        </small>
      </span>
      {i.record ? (
        <span className={fs.pillDone}>{i.record.status === "skipped" ? "Not needed" : "Filed"}</span>
      ) : typeof i.amount === "number" ? (
        <span className={i.status === "late" ? fs.pillLate : fs.amount}>{money(i.amount)}</span>
      ) : (
        <span className={i.status === "late" ? fs.pillLate : i.days <= 14 ? fs.pillSoon : fs.pill}>{i.status === "late" ? "Late" : dayWords(i.by, today)}</span>
      )}
    </button>
  );

  const item = sheet?.kind === "item" ? (items.find((i) => i.key === sheet.key) ?? null) : null;

  return (
    <>
      <SiteHeader eyebrow={tabs ? "Finance" : undefined} title="Tax & filings" sub={sub} onMenu={() => setMenuOpen(true)}>
        {tabs}
      </SiteHeader>
      {signedOut && (
        <div className={styles.banner} role="alert">
          You&rsquo;ve been signed out. <a href="/todo/filings">Sign in again</a>
        </div>
      )}
      {offline && !signedOut && (
        <div className={styles.banner} role="status">
          No signal: showing the filings as they were.
        </div>
      )}

      <main className={styles.main}>
        {!data ? (
          <p className={styles.loading}>Loading the company&rsquo;s filings…</p>
        ) : (
          <>
            <p className={late.length ? `${fin.verdict} ${fin.verdictShort}` : `${fin.verdict} ${fin.verdictOk}`} role="status">
              {late.length
                ? `${late.length} ${late.length === 1 ? "filing is" : "filings are"} late: ${late.map((i) => i.title).join(", ")}.`
                : next
                  ? `Nothing late. Next: ${next.name}, by ${dayWords(next.by, today)} (${inDays(daysBetween(today, next.by))}).`
                  : "Nothing late, nothing due."}
            </p>

            {setupOpen.length > 0 && (
              <section aria-label="Set up the company">
                <h2 className={styles.groupTitle}>
                  Set up the company <span>{setupOpen.length}</span>
                </h2>
                <div className={fin.week}>
                  {setupOpen.map(({ rule }) => (
                    <div key={rule.id} className={fs.setupRow}>
                      <button type="button" className={fs.tick} aria-label={`Done: ${rule.name}`} onClick={() => void tick(rule, true)}>
                        ✓
                      </button>
                      <button type="button" className={fs.setupText} onClick={() => setSheet({ kind: "setup", id: rule.id })}>
                        <b>{rule.name}</b>
                        <small>
                          {rule.who}
                          {rule.by ? ` · by ${dayWords(rule.by, today)}` : ""}
                          {!rule.sure ? " · check" : ""}
                        </small>
                      </button>
                    </div>
                  ))}
                </div>
                {setupDone.length > 0 && (
                  <button type="button" className={styles.linkButton} onClick={() => setShowDone(!showDone)}>
                    {showDone ? "Hide" : "Show"} the {setupDone.length} done
                  </button>
                )}
              </section>
            )}
            {(setupOpen.length === 0 || showDone) && setupDone.length > 0 && (
              <section aria-label="Set-up done">
                <h2 className={styles.groupTitle}>
                  Set-up done <span>{setupDone.length}</span>
                </h2>
                <div className={fin.week}>
                  {setupDone.map(({ rule, done }) => (
                    <div key={rule.id} className={fs.setupRow}>
                      <button type="button" className={fs.tickOn} aria-label={`Not done: ${rule.name}`} onClick={() => void tick(rule, false)}>
                        ✓
                      </button>
                      <button type="button" className={`${fs.setupText} ${fs.setupDone}`} onClick={() => setSheet({ kind: "setup", id: rule.id })}>
                        <b>{rule.name}</b>
                        <small>
                          Done {done ? dayWords(done.at.slice(0, 10), today) : ""}
                          {done?.note ? ` · ${done.note}` : ""}
                        </small>
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section aria-label="Coming up">
              <h2 className={styles.groupTitle}>
                Coming up <span>{late.length + soon.length}</span>
              </h2>
              <div className={fin.week}>{late.length + soon.length === 0 ? <p className={fin.weekEmpty}>Nothing in the next 6 weeks.</p> : [...late, ...soon].map(row)}</div>
            </section>

            {later.length > 0 && (
              <section aria-label="Later">
                <button type="button" className={styles.linkButton} onClick={() => setShowLater(!showLater)}>
                  {showLater ? "Hide the year ahead" : `Show the year ahead (${later.length})`}
                </button>
                {showLater && <div className={fin.week}>{later.map(row)}</div>}
              </section>
            )}

            {filed.length > 0 && (
              <section aria-label="Filed">
                <button type="button" className={styles.linkButton} onClick={() => setShowFiled(!showFiled)}>
                  {showFiled ? "Hide what's filed" : `Filed (${filed.length})`}
                </button>
                {showFiled && <div className={fin.week}>{filed.map(row)}</div>}
              </section>
            )}

            <h2 className={styles.groupTitle}>See the figures</h2>
            <div className={fs.forms}>
              {(["vat", "paye", "wht", "ssnit"] as FormKind[]).map((f) => (
                <button key={f} type="button" onClick={() => setSheet({ kind: "form", form: f, period: lastMonth, back: null })}>
                  {FORM_NAMES[f]}
                  <small className={fs.basis} style={{ display: "block", margin: 0 }}>
                    {monthName(lastMonth)}
                  </small>
                </button>
              ))}
            </div>

            <h2 className={styles.groupTitle}>Company details</h2>
            <section className={fin.week} aria-label="Company details">
              <dl className={fs.facts}>
                <div className={fs.fact}>
                  <div>
                    <dt>Company</dt>
                    <dd>{data.settings.company ? data.settings.company.name : "Not typed yet"}</dd>
                    {data.settings.company && (
                      <dt>
                        Reg. {data.settings.company.regNo || "?"} · TIN {data.settings.company.tin || "?"}
                      </dt>
                    )}
                  </div>
                  <button type="button" onClick={() => setSheet({ kind: "company" })}>
                    Change
                  </button>
                </div>
                <div className={fs.fact}>
                  <div>
                    <dt>VAT starts</dt>
                    <dd>{data.settings.vatFrom ? longDay(data.settings.vatFrom) : "Not registered yet"}</dd>
                  </div>
                  <button type="button" onClick={() => setSheet({ kind: "dates" })}>
                    Change
                  </button>
                </div>
                <div className={fs.fact}>
                  <div>
                    <dt>The company pays the site from</dt>
                    <dd>{data.settings.payFrom ? monthName(data.settings.payFrom) : "Not yet"}</dd>
                  </div>
                  <button type="button" onClick={() => setSheet({ kind: "dates" })}>
                    Change
                  </button>
                </div>
                <div className={fs.fact}>
                  <div>
                    <dt>Staff on salaries</dt>
                    <dd>{data.settings.staff.length ? data.settings.staff.map((x) => x.name).join(", ") : "None yet"}</dd>
                  </div>
                  <button type="button" onClick={() => setSheet({ kind: "staff" })}>
                    Change
                  </button>
                </div>
                <div className={fs.fact}>
                  <div>
                    <dt>Data Protection registration</dt>
                    <dd>{data.settings.dpcFrom ? longDay(data.settings.dpcFrom) : "Not yet"}</dd>
                  </div>
                  <button type="button" onClick={() => setSheet({ kind: "dates" })}>
                    Change
                  </button>
                </div>
              </dl>
            </section>

            <ul className={fin.notes}>
              <li>Every date is the law&rsquo;s, moved back to the working day before when it falls on a weekend or holiday.</li>
              <li>&ldquo;Check&rdquo; marks a date or rule that comes from practice or second-hand sources: confirm it with your accountant.</li>
              <li>Your phone gets a reminder two weeks before each return (with the amount once the month is over), 3 days before, on the day, and while it&rsquo;s late.</li>
            </ul>
          </>
        )}
      </main>

      {sheet?.kind === "item" && item && data && (
        <ItemSheet item={item} today={today} onClose={() => setSheet(null)} onSave={save} onFigures={(form, period) => setSheet({ kind: "form", form, period, back: item.key })} />
      )}
      {sheet?.kind === "setup" && data && (
        <SetupSheet rule={SETUP.find((r) => r.id === sheet.id)!} done={data.settings.setup[sheet.id] ?? null} today={today} onClose={() => setSheet(null)} onSave={save} />
      )}
      {sheet?.kind === "form" && data && (
        <FormSheet
          form={sheet.form}
          initialPeriod={sheet.period}
          today={today}
          data={data}
          onClose={() => setSheet(sheet.back ? { kind: "item", key: sheet.back } : null)}
          onSave={save}
        />
      )}
      {sheet?.kind === "dates" && data && <DatesSheet data={data} onClose={() => setSheet(null)} onSave={save} />}
      {sheet?.kind === "company" && data && <CompanySheet company={data.settings.company} onClose={() => setSheet(null)} onSave={save} />}
      {sheet?.kind === "staff" && data && <StaffSheet staff={data.settings.staff} today={today} onClose={() => setSheet(null)} onSave={save} />}
      {menuOpen && <SiteMenu me={me} onClose={() => setMenuOpen(false)} onRefresh={() => void refresh()} onLogins={() => setAccessOpen(true)} />}
      {accessOpen && <AccessSheet onClose={() => setAccessOpen(false)} />}
      {toast && (
        <div className={`${styles.toast} ${toast.tone === "error" ? styles.toastError : ""}`} role="status">
          <span>{toast.text}</span>
        </div>
      )}
    </>
  );
}

/* ---------- sheets ---------- */

function SheetButtons({ saving, onClose, onSave, label, closeLabel = "Cancel" }: { saving: boolean; onClose: () => void; onSave?: () => void; label?: string; closeLabel?: string }) {
  return (
    <div className={styles.sheetButtons}>
      <button type="button" className={styles.sheetCancel} onClick={onClose} disabled={saving}>
        {closeLabel}
      </button>
      {onSave && (
        <button type="button" className={styles.sheetSave} onClick={onSave} disabled={saving}>
          {saving ? "Saving…" : label}
        </button>
      )}
    </div>
  );
}

function RuleWords({ rule }: { rule: Rule }) {
  return (
    <>
      <p className={styles.sheetNote}>{rule.why}</p>
      <ol className={fs.steps}>
        {rule.how.map((h) => (
          <li key={h}>{h}</li>
        ))}
      </ol>
      {rule.link && (
        <a className={fs.outLink} href={rule.link.url} target="_blank" rel="noopener noreferrer">
          {rule.link.label} ↗
        </a>
      )}
      {!rule.sure && <p className={fs.check}>Check this one with your accountant: it comes from practice or second-hand sources, not the law&rsquo;s own text.</p>}
      {rule.basis && <p className={fs.basis}>Basis: {rule.basis}</p>}
    </>
  );
}

function ItemSheet({ item, today, onClose, onSave, onFigures }: { item: DueItem; today: string; onClose: () => void; onSave: Save; onFigures: (form: FormKind, period: string) => void }) {
  const rule = ruleById(item.rule)!;
  const [on, setOn] = useState(today);
  const [ref, setRef] = useState("");
  const [paid, setPaid] = useState(typeof item.amount === "number" ? String(item.amount) : "");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const go = async (body: Record<string, unknown>, text: string) => {
    setSaving(true);
    setError("");
    try {
      await onSave(body, text);
      onClose();
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };
  const monthOver = !item.form || item.period < today.slice(0, 7);
  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label={item.title}>
        <h2 className={styles.sheetTitle}>{item.title}</h2>
        <p className={fs.when}>
          {item.who} · {item.record ? "" : `${inDays(item.days)} · `}by {longDay(item.by)}
          {item.legal !== item.by ? ` (the law says ${dayWords(item.legal, today)}, a weekend or holiday)` : ""}
        </p>
        {item.record ? (
          <p className={fs.filed}>
            {item.record.status === "skipped" ? "Not needed this time" : "Filed"} on {longDay(item.record.on)}
            {item.record.ref ? ` · ref ${item.record.ref}` : ""}
            {item.record.paid !== null ? ` · ${money(item.record.paid)} paid` : ""}
            {item.record.note ? ` · ${item.record.note}` : ""}
          </p>
        ) : null}
        <RuleWords rule={rule} />
        {item.form && (
          <button type="button" className={styles.sheetSave} style={{ display: "block", width: "100%", marginBottom: 12 }} onClick={() => onFigures(item.form!, item.period)}>
            {monthOver ? `See the figures${typeof item.amount === "number" ? ` (${money(item.amount)} to pay)` : ""}` : `See the figures so far (${monthName(item.period)} isn't over)`}
          </button>
        )}
        {!item.record && (
          <>
            <div className={fs.twoCols}>
              <div>
                <label className={styles.label} htmlFor="fl-on">
                  Filed on
                </label>
                <input id="fl-on" className={styles.input} type="date" value={on} max={today} onChange={(e) => setOn(e.target.value)} disabled={saving} />
              </div>
              <div>
                <label className={styles.label} htmlFor="fl-paid">
                  Paid, GH₵
                </label>
                <input id="fl-paid" className={styles.input} inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} placeholder="e.g. 1250" disabled={saving} />
              </div>
            </div>
            <label className={styles.label} htmlFor="fl-ref">
              Reference (from the receipt or portal)
            </label>
            <input id="fl-ref" className={styles.input} value={ref} onChange={(e) => setRef(e.target.value)} maxLength={60} disabled={saving} />
            <label className={styles.label} htmlFor="fl-note">
              Note
            </label>
            <input id="fl-note" className={styles.input} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Optional" disabled={saving} />
          </>
        )}
        {error && (
          <p className={styles.sheetError} role="alert">
            {error}
          </p>
        )}
        {item.record ? (
          <>
            <button type="button" className={styles.linkButton} onClick={() => void go({ action: "unfiled", rule: item.rule, period: item.period }, `${item.title}: back to not filed`)} disabled={saving}>
              Undo: it isn&rsquo;t filed
            </button>
            <SheetButtons saving={saving} onClose={onClose} closeLabel="Close" />
          </>
        ) : (
          <>
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => void go({ action: "filed", rule: item.rule, period: item.period, status: "skipped", on, note: note || null }, `${item.title}: not needed`)}
              disabled={saving}
            >
              Not needed this time
            </button>
            <SheetButtons
              saving={saving}
              onClose={onClose}
              label="Mark filed"
              onSave={() => {
                const n = paid.trim() ? toNumber(paid) : null;
                if (paid.trim() && n === null) return setError("Type the amount paid as a number, e.g. 1250.50.");
                void go({ action: "filed", rule: item.rule, period: item.period, status: "filed", on, ref: ref || null, paid: n, note: note || null }, `${item.title}: filed`);
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}

function SetupSheet({ rule, done, today, onClose, onSave }: { rule: Rule; done: { at: string; by: string; note: string | null } | null; today: string; onClose: () => void; onSave: Save }) {
  const [note, setNote] = useState(done?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const go = async (isDone: boolean) => {
    setSaving(true);
    setError("");
    try {
      await onSave({ action: "setup", id: rule.id, done: isDone, note: note || null }, isDone ? `Done: ${rule.name}` : `Back on the list: ${rule.name}`);
      onClose();
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };
  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label={rule.name}>
        <h2 className={styles.sheetTitle}>{rule.name}</h2>
        <p className={fs.when}>
          {rule.who}
          {rule.by ? ` · aim for ${dayWords(rule.by, today)}` : ""}
        </p>
        {done && (
          <p className={fs.filed}>
            Done {dayWords(done.at.slice(0, 10), today)}
            {done.by ? ` by ${done.by}` : ""}
          </p>
        )}
        <RuleWords rule={rule} />
        <label className={styles.label} htmlFor="st-note">
          Note (a reference number, who you spoke to)
        </label>
        <input id="st-note" className={styles.input} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} disabled={saving} />
        {error && (
          <p className={styles.sheetError} role="alert">
            {error}
          </p>
        )}
        {done && (
          <button type="button" className={styles.linkButton} onClick={() => void go(false)} disabled={saving}>
            It isn&rsquo;t done yet
          </button>
        )}
        <SheetButtons saving={saving} onClose={onClose} label={done ? "Save the note" : "Done"} onSave={() => void go(true)} />
      </div>
    </div>
  );
}

type Editor = { kind: "buyer"; id: string } | { kind: "rate"; key: string } | { kind: "supplier"; key: string; name: string };

function FormSheet({ form, initialPeriod, today, data, onClose, onSave }: { form: FormKind; initialPeriod: string; today: string; data: FilingsPage; onClose: () => void; onSave: Save }) {
  const [period, setPeriod] = useState(initialPeriod);
  const [shown, setShown] = useState<{ sheet: Sheet; company: Company | null } | null>(null);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [version, setVersion] = useState(0);
  const thisMonth = today.slice(0, 7);

  useEffect(() => {
    let gone = false;
    fetch(`/api/filings?form=${form}&period=${period}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? "The figures didn't load. Try again.");
        return r.json() as Promise<{ sheet: Sheet; company: Company | null }>;
      })
      .then((x) => {
        if (gone) return;
        setShown(x);
        setError("");
      })
      .catch((e) => !gone && setError(errorText(e)));
    return () => {
      gone = true;
    };
  }, [form, period, version]);

  const download = () => {
    if (!shown) return;
    const blob = new Blob([sheetCsv(shown.sheet, shown.company)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${FORM_NAMES[form].replace(/\s+/g, "-")}-${period}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const saved = async (body: Record<string, unknown>, text: string) => {
    await onSave(body, text);
    setEditor(null);
    setVersion((v) => v + 1);
  };
  const sheet = shown?.sheet.period === period ? shown.sheet : null;

  return (
    <div className={styles.sheetBackdrop}>
      <div className={`${styles.sheet} ${fs.wide}`} role="dialog" aria-label={`${FORM_NAMES[form]}, ${monthName(period)}`}>
        <h2 className={styles.sheetTitle}>{FORM_NAMES[form]}</h2>
        <div className={fs.monthNav}>
          <button type="button" aria-label="The month before" onClick={() => {
              setError("");
              setPeriod(prevMonth(period));
            }} disabled={period <= "2026-01"}>
            ‹
          </button>
          <b>{monthName(period)}</b>
          <button type="button" aria-label="The month after" onClick={() => {
              setError("");
              setPeriod(nextMonth(period));
            }} disabled={period >= thisMonth}>
            ›
          </button>
        </div>
        {error && (
          <p className={styles.sheetError} role="alert">
            {error}
          </p>
        )}
        {!sheet && !error && <p className={styles.loading}>Working out the figures…</p>}
        {sheet && (
          <>
            {sheet.practice && <p className={fs.practice}>{sheet.practice}</p>}
            {period === thisMonth && <p className={fs.practice}>{monthName(period)} isn&rsquo;t over: these are the figures so far.</p>}
            <div className={fs.boxes}>
              {sheet.boxes.map((b) => (
                <div key={b.label} className={b.strong ? fs.boxStrong : fs.box}>
                  <span>{b.label}</span>
                  <span>{money(b.amount)}</span>
                </div>
              ))}
            </div>
            {sheet.tables.map((t) => (
              <section key={t.title}>
                <h3 className={fs.tableTitle}>{t.title}</h3>
                <div className={fs.tableWrap}>
                  {t.rows.length === 0 ? (
                    <p className={fs.empty}>{t.empty}</p>
                  ) : (
                    <table className={fs.table}>
                      <thead>
                        <tr>
                          {t.columns.map((c, i) => (
                            <th key={c} className={i > 0 && /^(Paid|GH₵|Before|Tax|This|WHT|Pay|Salary|SSNIT|Taxable|PAYE|Take|Employee|Company|Tier)/.test(c) ? "num" : undefined}>
                              {c}
                            </th>
                          ))}
                          <th aria-label="Change" />
                        </tr>
                      </thead>
                      <tbody>
                        {t.rows.map((r, ri) => (
                          <tr key={ri} className={r.muted ? fs.rowMuted : undefined}>
                            {r.cells.map((c, ci) => (
                              <td key={ci} className={ci > 0 && /^-?[\d,]+\.\d\d$/.test(c) ? "num" : undefined}>
                                {c}
                                {ci === 1 && r.warn ? <span className={fs.rowWarn}>{r.warn}</span> : null}
                              </td>
                            ))}
                            <td>
                              {r.action && (
                                <button
                                  type="button"
                                  className={fs.rowButton}
                                  onClick={() => setEditor(r.action!.kind === "supplier" ? { kind: "supplier", key: r.action!.id, name: r.cells[0] } : r.action!.kind === "rate" ? { kind: "rate", key: r.action!.id } : { kind: "buyer", id: r.action!.id })}
                                >
                                  {r.action.label}
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>
            ))}
            <ul className={fs.sheetNotes}>
              {sheet.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </>
        )}
        <div className={styles.sheetButtons}>
          <button type="button" className={styles.sheetCancel} onClick={onClose}>
            Close
          </button>
          <button type="button" className={styles.sheetSave} onClick={download} disabled={!sheet}>
            Download for Excel
          </button>
        </div>
      </div>
      {editor?.kind === "buyer" && <BuyerVatSheet buyer={data.buyers.find((b) => b.id === editor.id) ?? null} id={editor.id} onClose={() => setEditor(null)} onSave={saved} />}
      {editor?.kind === "rate" && <RateSheet payment={editor.key} rate={data.settings.rates[editor.key] ?? null} last={data.lastRate} onClose={() => setEditor(null)} onSave={saved} />}
      {editor?.kind === "supplier" && <SupplierSheet keyName={editor.key} name={editor.name} set={data.settings.suppliers[editor.key] ?? {}} onClose={() => setEditor(null)} onSave={saved} />}
    </div>
  );
}

/** An editor sheet over the figures (its own shade, so a tap outside closes only it). */
function Over({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

function BuyerVatSheet({ buyer, id, onClose, onSave }: { buyer: FilingsPage["buyers"][number] | null; id: string; onClose: () => void; onSave: Save }) {
  const [choice, setChoice] = useState<"on" | "off" | "auto">(buyer?.set ? (buyer.vat ? "on" : "off") : "auto");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const go = async () => {
    setSaving(true);
    setError("");
    try {
      await onSave({ action: "buyer", id, vat: choice === "auto" ? null : choice === "on" }, "Saved");
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };
  return (
    <Over label="This buyer's VAT">
      <h2 className={styles.sheetTitle}>{buyer ? `${buyer.name}${buyer.unit ? ` (${buyer.unit})` : ""}` : "This buyer"}</h2>
      <p className={styles.sheetNote}>Do this buyer&rsquo;s payments carry the company&rsquo;s VAT?</p>
      <div className={fs.options}>
        {(
          [
            ["on", "Yes: a sale by the company, VAT in each payment"],
            ["off", "No: a contract from before the company's VAT (in Leo's name)"],
            ["auto", "Let the app decide: yes if their first payment came after the VAT date"],
          ] as const
        ).map(([v, words]) => (
          <label key={v} className={fs.option}>
            <input type="radio" name="bv" checked={choice === v} onChange={() => setChoice(v)} disabled={saving} />
            <span>{words}</span>
          </label>
        ))}
      </div>
      {error && (
        <p className={styles.sheetError} role="alert">
          {error}
        </p>
      )}
      <SheetButtons saving={saving} onClose={onClose} label="Save" onSave={() => void go()} />
    </Over>
  );
}

function RateSheet({ payment, rate, last, onClose, onSave }: { payment: string; rate: number | null; last: number | null; onClose: () => void; onSave: Save }) {
  const [value, setValue] = useState(rate !== null ? String(rate) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const go = async (clear: boolean) => {
    const n = toNumber(value);
    if (!clear && !(n && n > 0.5)) return setError("Type the rate as GH₵ for one US$, e.g. 11.65.");
    setSaving(true);
    setError("");
    try {
      await onSave({ action: "rate", key: payment, rate: clear ? null : n }, clear ? "Rate taken off" : `Counted at GH₵ ${n} a dollar`);
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };
  return (
    <Over label="The dollar rate">
      <h2 className={styles.sheetTitle}>The dollar rate that day</h2>
      <p className={styles.sheetNote}>VAT on a dollar payment counts in cedis at the Bank of Ghana rate for the day it came in{last ? `. The last cedi payment used GH₵ ${last}.` : "."}</p>
      <label className={styles.label} htmlFor="rt-rate">
        GH₵ for one US$
      </label>
      <input id="rt-rate" className={styles.input} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 11.65" disabled={saving} />
      {error && (
        <p className={styles.sheetError} role="alert">
          {error}
        </p>
      )}
      {rate !== null && (
        <button type="button" className={styles.linkButton} onClick={() => void go(true)} disabled={saving}>
          Take the rate off
        </button>
      )}
      <SheetButtons saving={saving} onClose={onClose} label="Use this rate" onSave={() => void go(false)} />
    </Over>
  );
}

function SupplierSheet({ keyName, name, set, onClose, onSave }: { keyName: string; name: string; set: { type?: WhtType; tin?: string }; onClose: () => void; onSave: Save }) {
  const [type, setType] = useState<WhtType | "">(set.type ?? "");
  const [tin, setTin] = useState(set.tin ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const go = async () => {
    setSaving(true);
    setError("");
    try {
      await onSave({ action: "supplier", key: keyName, type: type || null, tin: tin.trim() || null }, `Saved: ${name}`);
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };
  return (
    <Over label={`${name}: withholding tax`}>
      <h2 className={styles.sheetTitle}>{name}</h2>
      <label className={styles.label} htmlFor="sp-type">
        What they supply
      </label>
      <select id="sp-type" className={styles.input} value={type} onChange={(e) => setType(e.target.value as WhtType | "")} disabled={saving}>
        <option value="">Guess from each expense</option>
        {(["goods", "works", "services", "none"] as WhtType[]).map((t) => (
          <option key={t} value={t}>
            {WHT_WORDS[t]}
          </option>
        ))}
      </select>
      <label className={styles.label} htmlFor="sp-tin">
        Their TIN (on their invoice)
      </label>
      <input id="sp-tin" className={styles.input} value={tin} onChange={(e) => setTin(e.target.value.toUpperCase())} maxLength={20} placeholder="e.g. C0001234567" disabled={saving} />
      <p className={styles.sheetNote}>No WHT: e.g. the bank, GRA, SSNIT, or someone paid back.</p>
      {error && (
        <p className={styles.sheetError} role="alert">
          {error}
        </p>
      )}
      <SheetButtons saving={saving} onClose={onClose} label="Save" onSave={() => void go()} />
    </Over>
  );
}

function DatesSheet({ data, onClose, onSave }: { data: FilingsPage; onClose: () => void; onSave: Save }) {
  const s = data.settings;
  const [vatFrom, setVatFrom] = useState(s.vatFrom ?? "");
  const [payFrom, setPayFrom] = useState(s.payFrom ?? "");
  const [dpcFrom, setDpcFrom] = useState(s.dpcFrom ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const go = async () => {
    if (payFrom && !MONTH_RE.test(payFrom)) return setError("Pick the month, e.g. 2026-12.");
    setSaving(true);
    setError("");
    try {
      await onSave({ action: "dates", vatFrom: vatFrom || null, payFrom: payFrom || null, dpcFrom: dpcFrom || null }, "Dates saved");
      onClose();
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };
  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label="When things start">
        <h2 className={styles.sheetTitle}>When things start</h2>
        <label className={styles.label} htmlFor="dt-vat">
          The company&rsquo;s VAT starts (on GRA&rsquo;s certificate)
        </label>
        <input id="dt-vat" className={styles.input} type="date" value={vatFrom} min="2026-11-17" onChange={(e) => setVatFrom(e.target.value)} disabled={saving} />
        <p className={styles.sheetNote}>The monthly VAT returns start from that month.</p>
        <label className={styles.label} htmlFor="dt-pay">
          The company pays the site&rsquo;s wages and suppliers from
        </label>
        <input id="dt-pay" className={styles.input} type="month" value={payFrom} min="2026-11" onChange={(e) => setPayFrom(e.target.value)} placeholder="2026-12" disabled={saving} />
        <p className={styles.sheetNote}>From the company&rsquo;s own bank account: PAYE, withholding tax and SSNIT start that month.</p>
        <label className={styles.label} htmlFor="dt-dpc">
          Registered with the Data Protection Commission on
        </label>
        <input id="dt-dpc" className={styles.input} type="date" value={dpcFrom} onChange={(e) => setDpcFrom(e.target.value)} disabled={saving} />
        {error && (
          <p className={styles.sheetError} role="alert">
            {error}
          </p>
        )}
        <SheetButtons saving={saving} onClose={onClose} label="Save" onSave={() => void go()} />
      </div>
    </div>
  );
}

function CompanySheet({ company, onClose, onSave }: { company: Company | null; onClose: () => void; onSave: Save }) {
  const [c, setC] = useState<Company>(company ?? { name: "", regNo: "", tin: "", incorporated: "2026-11-17", address: "", auditor: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const field = (k: keyof Company, label: string, extra: Record<string, unknown> = {}) => (
    <>
      <label className={styles.label} htmlFor={`co-${k}`}>
        {label}
      </label>
      <input id={`co-${k}`} className={styles.input} value={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.value })} disabled={saving} {...extra} />
    </>
  );
  const go = async () => {
    setSaving(true);
    setError("");
    try {
      await onSave({ action: "company", company: c }, "Company details saved");
      onClose();
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };
  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label="Company details">
        <h2 className={styles.sheetTitle}>Company details</h2>
        {field("name", "Name")}
        {field("regNo", "Registration number")}
        {field("tin", "TIN")}
        {field("incorporated", "Incorporated on", { type: "date" })}
        {field("address", "Registered address")}
        {field("auditor", "Auditor")}
        {error && (
          <p className={styles.sheetError} role="alert">
            {error}
          </p>
        )}
        <SheetButtons saving={saving} onClose={onClose} label="Save" onSave={() => void go()} />
      </div>
    </div>
  );
}

function StaffSheet({ staff, today, onClose, onSave }: { staff: Staff[]; today: string; onClose: () => void; onSave: Save }) {
  const blank = { id: "", name: "", salary: "", ssnit: true, from: today.slice(0, 7), until: "" };
  const [edit, setEdit] = useState<typeof blank | null>(staff.length ? null : blank);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const go = async (body: Record<string, unknown>, text: string) => {
    setSaving(true);
    setError("");
    try {
      await onSave(body, text);
      setEdit(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label="Staff on salaries">
        <h2 className={styles.sheetTitle}>Staff on salaries</h2>
        <p className={styles.sheetNote}>People paid by the month (not the daily-paid workers in Payday): their PAYE and SSNIT are worked out each month.</p>
        {!edit && (
          <>
            {staff.map((x) => (
              <div key={x.id} className={fs.staffRow}>
                <div>
                  <b>{x.name}</b>
                  <small>
                    {money(x.salary)} a month · {x.ssnit ? "on SSNIT" : "no SSNIT"} · from {monthName(x.from)}
                    {x.until ? ` to ${monthName(x.until)}` : ""}
                  </small>
                </div>
                <button type="button" className={fs.rowButton} onClick={() => setEdit({ id: x.id, name: x.name, salary: String(x.salary), ssnit: x.ssnit, from: x.from, until: x.until ?? "" })}>
                  Change
                </button>
              </div>
            ))}
            <button type="button" className={styles.linkButton} onClick={() => setEdit(blank)}>
              + Add someone
            </button>
          </>
        )}
        {edit && (
          <>
            <label className={styles.label} htmlFor="sf-name">
              Name
            </label>
            <input id="sf-name" className={styles.input} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={60} disabled={saving} />
            <label className={styles.label} htmlFor="sf-salary">
              Monthly salary, GH₵ (before tax)
            </label>
            <input id="sf-salary" className={styles.input} inputMode="decimal" value={edit.salary} onChange={(e) => setEdit({ ...edit, salary: e.target.value })} placeholder="e.g. 3500" disabled={saving} />
            <label className={fs.option}>
              <input type="checkbox" checked={edit.ssnit} onChange={(e) => setEdit({ ...edit, ssnit: e.target.checked })} disabled={saving} />
              <span>On SSNIT</span>
            </label>
            <div className={fs.twoCols}>
              <div>
                <label className={styles.label} htmlFor="sf-from">
                  From
                </label>
                <input id="sf-from" className={styles.input} type="month" value={edit.from} onChange={(e) => setEdit({ ...edit, from: e.target.value })} disabled={saving} />
              </div>
              <div>
                <label className={styles.label} htmlFor="sf-until">
                  Until (if leaving)
                </label>
                <input id="sf-until" className={styles.input} type="month" value={edit.until} onChange={(e) => setEdit({ ...edit, until: e.target.value })} disabled={saving} />
              </div>
            </div>
            {edit.id && (
              <button type="button" className={styles.linkButton} onClick={() => void go({ action: "staffdelete", id: edit.id }, `${edit.name} taken off`)} disabled={saving}>
                Take {edit.name || "them"} off the list
              </button>
            )}
          </>
        )}
        {error && (
          <p className={styles.sheetError} role="alert">
            {error}
          </p>
        )}
        {edit ? (
          <SheetButtons
            saving={saving}
            onClose={() => (staff.length ? setEdit(null) : onClose())}
            label="Save"
            onSave={() => {
              const salary = toNumber(edit.salary);
              if (!edit.name.trim()) return setError("Type their name.");
              if (!salary || salary <= 0) return setError("Type the monthly salary, e.g. 3500.");
              void go({ action: "staff", id: edit.id || undefined, name: edit.name, salary, ssnit: edit.ssnit, from: edit.from, until: edit.until || null }, `Saved: ${edit.name}`);
            }}
          />
        ) : (
          <SheetButtons saving={saving} onClose={onClose} closeLabel="Close" />
        )}
      </div>
    </div>
  );
}
