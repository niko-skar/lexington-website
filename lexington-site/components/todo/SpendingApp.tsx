"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { money } from "@/lib/expenses/shared";
import {
  byClass,
  byFloor,
  byMonth,
  bySupplier,
  checksOf,
  entriesOf,
  inPeriod,
  isCost,
  PERIOD_NAMES,
  PERIODS,
  periodDays,
  total,
  type Period,
  type Row,
  type SpendEntry,
  type SpendingData,
} from "@/lib/spending/shared";
import type { TodoMe } from "@/lib/todo/shared";
import { AccessSheet } from "./AccessSheet";
import { errorText, send, startPolling } from "./api";
import { niceDate } from "./ExpenseForm";
import { SiteHeader, SiteMenu } from "./SiteChrome";
import sp from "./Spending.module.css";
import styles from "./Todo.module.css";

// Spending (lib/spending/shared.ts says what and why): what was spent, for any period, by cost type, floor or stage,
// supplier and month, from QuickBooks' own transactions and the app's entries not there yet; tap a line for what's
// in it; and what to put right in the books (no supplier, no cost type, a day and month swapped, a month with nothing).

type By = "class" | "floor" | "supplier" | "month";
const BY_NAMES: Record<By, string> = { class: "Cost type", floor: "Floor", supplier: "Supplier", month: "Month" };
type Fix = "noSupplier" | "noClass" | "odd";
const FIX_NAMES: Record<Fix, string> = { noSupplier: "No supplier", noClass: "No cost type", odd: "Dated long after they were typed" };
type ToastData = { text: string; tone?: "error" };

const monthName = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const kindWord = (e: SpendEntry) => (e.kind === "payment" ? "paid a bill" : e.kind === "bill" ? "bill" : e.kind === "credit" ? "credit" : "expense");

export function SpendingApp({ me, active, initial, startedOffline, fresh }: { me: TodoMe; active: boolean; initial: SpendingData | null; startedOffline: boolean; fresh: boolean }) {
  const [data, setData] = useState<SpendingData | null>(initial);
  const [offline, setOffline] = useState(startedOffline);
  const [signedOut, setSignedOut] = useState(false);
  const [period, setPeriod] = useState<Period>("all");
  const [by, setBy] = useState<By>("class");
  const [open, setOpen] = useState<{ by: By | Fix; name: string } | null>(null);
  const [reading, setReading] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const inFlight = useRef(false);
  const lastLoadedAt = useRef(0);
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
    try {
      const response = await fetch("/api/spending", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        setSignedOut(true);
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      setData((await response.json()) as SpendingData);
      lastLoadedAt.current = Date.now();
      setOffline(false);
    } catch {
      setOffline(true);
    } finally {
      inFlight.current = false;
    }
  }, []);

  // It changes slowly (QuickBooks is read every few hours): looked at again every few minutes while on screen.
  useEffect(() => {
    if (!active) return;
    if (skipFirst.current) skipFirst.current = false;
    else if (Date.now() - lastLoadedAt.current > 60_000) void refresh();
    return startPolling(refresh, 300_000, 900_000);
  }, [active, refresh]);

  const readAgain = async () => {
    setReading(true);
    try {
      const next = await send<SpendingData>("/api/spending", "POST", { action: "refresh" });
      setData(next);
      showToast({ text: next.error ? `QuickBooks: ${next.error}` : "Read from QuickBooks just now", tone: next.error ? "error" : undefined });
    } catch (e) {
      showToast({ text: errorText(e), tone: "error" });
    } finally {
      setReading(false);
    }
  };

  const today = data?.today ?? new Date().toISOString().slice(0, 10);
  const days = periodDays(period, today);
  const shown = useMemo(() => (data?.entries ?? []).filter((e) => inPeriod(e, days)), [data, days.from, days.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const spent = total(shown);
  const rows: Row[] = useMemo(() => {
    if (by === "class") return byClass(shown);
    if (by === "floor") return byFloor(shown);
    if (by === "supplier") return bySupplier(shown);
    return [...byMonth(shown)].reverse();
  }, [by, shown]);
  const biggest = Math.max(1, ...rows.map((r) => Math.abs(r.amount)));
  const checks = useMemo(() => checksOf(data?.entries ?? []), [data]);
  const notIn = useMemo(() => (data?.entries ?? []).filter((e) => e.source === "app" && isCost(e)), [data]);
  const list: SpendEntry[] = useMemo(() => {
    if (!open || !data) return [];
    if (open.by === "noSupplier" || open.by === "noClass" || open.by === "odd") return checks[open.by];
    return entriesOf(shown, open.by === "class" ? "class" : open.by, open.name);
  }, [open, data, checks, shown]);

  const sub = !data ? "Loading…" : `${money(spent)} · ${PERIOD_NAMES[period].toLowerCase()}`;

  return (
    <>
      <SiteHeader title="Spending" sub={sub} onMenu={() => setMenuOpen(true)} />
      {signedOut && (
        <div className={styles.banner} role="alert">
          You&rsquo;ve been signed out. <a href="/todo/spending">Sign in again</a>
        </div>
      )}
      {offline && !signedOut && (
        <div className={styles.banner} role="status">
          No signal: showing the spending as it was.
        </div>
      )}

      <main className={styles.main}>
        {!data ? (
          <p className={styles.loading}>Loading the spending…</p>
        ) : open ? (
          <>
            <button type="button" className={sp.back} onClick={() => setOpen(null)}>
              ‹ {open.by === "noSupplier" || open.by === "noClass" || open.by === "odd" ? "Spending" : `By ${BY_NAMES[open.by].toLowerCase()}`}
            </button>
            <section className={sp.card} aria-label={open.name}>
              <p className={sp.cardName}>{open.by === "month" ? monthName(open.name) : open.name}</p>
              <p className={sp.big}>{money(open.by === "class" ? sumClass(list, open.name) : total(list))}</p>
              <p className={sp.line}>
                {list.length} {list.length === 1 ? "entry" : "entries"}
                {open.by === "noSupplier" || open.by === "noClass" || open.by === "odd" ? " (all time)" : ` · ${PERIOD_NAMES[period].toLowerCase()}`}
                {open.by === "odd" ? ": probably the day and month swapped when typed (8/2 for 8 February read as 2 August). Fix their dates in QuickBooks." : ""}
              </p>
            </section>
            <Entries entries={list} />
          </>
        ) : (
          <>
            <div className={sp.periods} role="group" aria-label="Period">
              {PERIODS.map((p) => (
                <button key={p} type="button" className={period === p ? styles.chipOn : styles.chip} aria-pressed={period === p} onClick={() => setPeriod(p)}>
                  {PERIOD_NAMES[p]}
                </button>
              ))}
            </div>
            <section className={sp.card} aria-label="Spent">
              <p className={sp.big}>{money(spent)}</p>
              <p className={sp.line}>
                spent {period === "all" ? "in all" : PERIOD_NAMES[period].toLowerCase()} · {shown.filter(isCost).length} entries
              </p>
            </section>
            <div className={`${styles.tabs} ${styles.tabs4}`} role="tablist" aria-label="Add up by">
              {(Object.keys(BY_NAMES) as By[]).map((b) => (
                <button key={b} type="button" role="tab" aria-selected={by === b} className={by === b ? styles.tabOn : styles.tab} onClick={() => setBy(b)}>
                  {BY_NAMES[b]}
                </button>
              ))}
            </div>
            {rows.length === 0 ? (
              <p className={styles.empty}>Nothing spent {PERIOD_NAMES[period].toLowerCase()}.</p>
            ) : (
              <div className={sp.rows}>
                {rows.map((r) => (
                  <button key={r.name} type="button" className={sp.row} onClick={() => setOpen({ by, name: r.name })} disabled={r.count === 0}>
                    <span className={sp.bar} style={{ width: `${Math.max(0, (Math.abs(r.amount) / biggest) * 100)}%` }} aria-hidden="true" />
                    <span className={sp.rowText}>
                      <b>{by === "month" ? monthName(r.name) : r.name}</b>
                      <small>{r.count === 0 ? "nothing recorded" : `${r.count} ${r.count === 1 ? "entry" : "entries"}${spent ? ` · ${Math.round((r.amount / spent) * 100)}%` : ""}`}</small>
                    </span>
                    <span className={r.count === 0 ? sp.amountNone : sp.amount}>{money(r.amount)}</span>
                  </button>
                ))}
              </div>
            )}

            <h2 className={styles.groupTitle}>To put right in QuickBooks</h2>
            <div className={sp.checks}>
              {(Object.keys(FIX_NAMES) as Fix[]).map((f) =>
                checks[f].length ? (
                  <button key={f} type="button" className={sp.check} onClick={() => setOpen({ by: f, name: FIX_NAMES[f] })}>
                    <b>{FIX_NAMES[f]}</b>
                    <small>
                      {checks[f].length} {checks[f].length === 1 ? "entry" : "entries"} · {money(total(checks[f]))}
                    </small>
                  </button>
                ) : null
              )}
              {checks.emptyMonths.length > 0 && (
                <p className={sp.checkLine}>
                  <b>Nothing recorded in:</b> {checks.emptyMonths.map(monthName).join(", ")}
                </p>
              )}
              {!checks.noSupplier.length && !checks.noClass.length && !checks.odd.length && !checks.emptyMonths.length && <p className={sp.checkLine}>Nothing to put right.</p>}
            </div>
            {notIn.length > 0 && (
              <p className={sp.note}>
                {notIn.length} {notIn.length === 1 ? "entry" : "entries"} ({money(total(notIn))}) from the app aren&rsquo;t in QuickBooks yet: they&rsquo;re counted here, marked
                &ldquo;app only&rdquo;.
              </p>
            )}
            <p className={sp.note}>
              {data.connected
                ? data.fetchedAt
                  ? `Read from QuickBooks ${niceDate(data.fetchedAt.slice(0, 10))} ${new Date(data.fetchedAt).toISOString().slice(11, 16)} (read again every few hours).`
                  : "QuickBooks hasn't been read yet."
                : "QuickBooks isn't connected: only the app's own entries are here."}
              {data.error ? ` Last try: ${data.error}` : ""}
            </p>
            {data.connected && (
              <button type="button" className={sp.readAgain} onClick={() => void readAgain()} disabled={reading}>
                {reading ? "Reading QuickBooks…" : "Read QuickBooks again now"}
              </button>
            )}
          </>
        )}
      </main>

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

/** What a cost type's lines add up to (an entry can carry several cost types). */
const sumClass = (entries: readonly SpendEntry[], name: string) =>
  Math.round(entries.reduce((n, e) => n + e.lines.filter((l) => (l.cls || "No cost type") === name).reduce((m, l) => m + l.amount, 0), 0) * 100) / 100;

/** Entries, newest first: when, who, what, how much, and where it's from. */
export function Entries({ entries, limit = 200, hideSupplier }: { entries: readonly SpendEntry[]; limit?: number; hideSupplier?: boolean }) {
  const [all, setAll] = useState(false);
  const shown = all ? entries : entries.slice(0, limit);
  if (!entries.length) return <p className={sp.note}>Nothing here.</p>;
  return (
    <>
      <ul className={sp.entries}>
        {shown.map((e) => (
          <li key={e.key} className={e.odd ? sp.entryOdd : undefined}>
            <span className={sp.entryMain}>
              <span>
                {niceDate(e.date)}
                {hideSupplier ? "" : " · "}
                {!hideSupplier && <b>{e.supplier || "No supplier"}</b>}
              </span>
              <b className={e.amount < 0 ? sp.credit : undefined}>{money(e.amount)}</b>
            </span>
            {e.description && <span className={sp.entryWhat}>{e.description}</span>}
            <small>
              {[
                kindWord(e),
                e.pays ? `pays ${e.pays}` : "",
                e.lines.map((l) => l.cls).filter(Boolean).join(", "),
                e.floor ?? "",
                e.ref ?? "",
                e.source === "app" ? "app only (not in QuickBooks yet)" : "",
                e.odd ? "dated long after it was typed" : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </small>
          </li>
        ))}
      </ul>
      {entries.length > shown.length && (
        <button type="button" className={styles.linkButton} onClick={() => setAll(true)}>
          Show all {entries.length}
        </button>
      )}
    </>
  );
}
