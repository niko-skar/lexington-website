"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CashflowPage } from "@/lib/cashflow/server";
import { addDays, forecast, MAX_WEEKS, REPEATS, WEEKS, type CashBuyer, type CashItem, type CashPlan, type CashWeek, type Currency, type Forecast, type Repeat, type WageWeek } from "@/lib/cashflow/shared";
import { money } from "@/lib/expenses/shared";
import type { TodoMe } from "@/lib/todo/shared";
import { AccessSheet } from "./AccessSheet";
import { errorText, send, startPolling, when } from "./api";
import fin from "./Finance.module.css";
import { SiteHeader, SiteMenu } from "./SiteChrome";
import styles from "./Todo.module.css";

// The cash flow (lib/cashflow/shared.ts says what and why): the money now, whether it runs short and when, a column
// for each week's end, then the weeks one by one with what's in them. Tapping a bill opens its supplier; an order, the
// order; the wages or a plan, their sheet. Above the weeks, the money coming in: Leo's (estimated each week), each buyer's
// payments as planned, new buyers expected, and the dollar rate they count at.

type ToastData = { text: string; tone?: "error" };
type Sheet =
  | { kind: "money" }
  | { kind: "wages" }
  | { kind: "leo" }
  | { kind: "rate" }
  // A plan: one of any kind, a buyer's payments (buyer), or new buyers' money expected (sale).
  | { kind: "plan"; plan: CashPlan | null; direction: "in" | "out"; buyer?: CashBuyer | null; sale?: boolean };

const short = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const dayWords = (day: string, today: string) =>
  day === today ? "Today" : day === addDays(today, 1) ? "Tomorrow" : new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
/** "This week · 2–8 Nov", "Week · 30 Nov–6 Dec". */
const weekName = (w: CashWeek, i: number) => {
  const sameMonth = w.start.slice(0, 7) === w.end.slice(0, 7);
  return `${i === 0 ? "This week" : i === 1 ? "Next week" : "Week"} · ${sameMonth ? Number(w.start.slice(8)) : short(w.start)}–${short(w.end)}`;
};
/** "45K", "−18K", "1.2m": for the chart's few labels (the weeks below say each in full). */
const compact = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}m` : a >= 1000 ? `${Math.round(a / 1000)}K` : `${Math.round(a)}`;
  return `${n < 0 ? "−" : ""}${s}`;
};
const toNumber = (s: string) => {
  const n = parseFloat(s.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const REPEAT_WORDS: Record<Repeat, string> = { once: "Once", week: "Every week", month: "Every month" };
const WEEKDAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const usd = (n: number) => `US$ ${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const inMoney = (amount: number, currency: Currency) => (currency === "USD" ? usd(amount) : money(amount));
/** "US$ 2,000 every month from 20 Nov", "GH₵ 50,000.00 on 12 Nov". */
const planWords = (p: CashPlan) =>
  p.repeat === "once" ? `${inMoney(p.amount, p.currency)} on ${short(p.date)}` : `${inMoney(p.amount, p.currency)} ${REPEAT_WORDS[p.repeat].toLowerCase()} from ${short(p.date)}${p.until ? ` to ${short(p.until)}` : ""}`;

export function CashflowApp({
  me,
  active,
  initial,
  startedOffline,
  fresh,
  tabs,
  onBill,
  onOrder,
}: {
  me: TodoMe;
  active: boolean;
  initial: CashflowPage | null;
  startedOffline: boolean;
  fresh: boolean;
  /** Finance's tabs, under the header. */
  tabs?: React.ReactNode;
  /** A bill on the list: its supplier's page. */
  onBill: (vendorId: string) => void;
  /** An order on the list: the order. */
  onOrder: (orderId: string) => void;
}) {
  const [data, setData] = useState<CashflowPage | null>(initial);
  const [weeks, setWeeks] = useState(WEEKS);
  const [offline, setOffline] = useState(startedOffline);
  const [signedOut, setSignedOut] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
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
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const startedAt = Date.now();
    try {
      const response = await fetch("/api/cashflow", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        setSignedOut(true);
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      const next = (await response.json()) as CashflowPage;
      lastLoadedAt.current = Date.now();
      setOffline(false);
      if (startedAt >= localAt.current) setData(next);
    } catch {
      setOffline(true);
    } finally {
      inFlight.current = false;
    }
  }, []);

  // What it's worked out from moves whenever anything is logged: fresh each time it's opened, and every minute on screen.
  useEffect(() => {
    if (!active) return;
    if (skipFirst.current) skipFirst.current = false;
    else if (Date.now() - lastLoadedAt.current > 4_000) void refresh();
    return startPolling(refresh, 60_000, 180_000);
  }, [active, refresh]);

  const save = async (body: Record<string, unknown>, text: string) => {
    const next = await send<CashflowPage>("/api/cashflow", "POST", body);
    localAt.current = Date.now();
    setData(next);
    setSheet(null);
    showToast({ text });
  };

  const f = useMemo(() => (data ? forecast(data.inputs, weeks) : null), [data, weeks]);
  const today = data?.inputs.today ?? new Date().toISOString().slice(0, 10);
  const past = (data?.inputs.plans ?? []).filter((p) => (p.repeat === "once" ? p.date < today : !!p.until && p.until < today));

  const open = (item: CashItem) => {
    if (item.kind === "wages") setSheet({ kind: "wages" });
    else if (item.kind === "leo") setSheet({ kind: "leo" });
    else if (item.kind === "bill") {
      const bill = data?.inputs.bills.find((b) => b.id === item.id);
      if (bill) onBill(bill.vendorId);
    } else if (item.kind === "order" && item.id) onOrder(item.id);
    else if (item.kind === "plan") {
      const plan = data?.inputs.plans.find((p) => p.id === item.id) ?? null;
      const buyer = plan?.buyerId ? (data?.inputs.buyers.find((b) => b.id === plan.buyerId) ?? null) : null;
      if (plan) setSheet({ kind: "plan", plan, direction: plan.direction, buyer, sale: plan.currency === "USD" && !plan.buyerId });
    }
  };

  const sub = !f ? "Loading…" : f.now === null ? "Type the money now to start" : `${money(f.now)} now · lowest ${money(f.lowest?.amount ?? f.now)}${f.lowest && f.lowest.amount < f.now ? ` (${short(f.lowest.date)})` : ""}`;

  return (
    <>
      <SiteHeader eyebrow={tabs ? "Finance" : undefined} title="Cash flow" sub={sub} onMenu={() => setMenuOpen(true)}>
        {tabs}
      </SiteHeader>
      {signedOut && (
        <div className={styles.banner} role="alert">
          You&rsquo;ve been signed out. <a href="/todo/cashflow">Sign in again</a>
        </div>
      )}
      {offline && !signedOut && (
        <div className={styles.banner} role="status">
          No signal: showing the cash flow as it was.
        </div>
      )}

      <main className={styles.main}>
        {!data || !f ? (
          <p className={styles.loading}>Working out the cash flow…</p>
        ) : (
          <>
            <section className={fin.money} aria-label="Money now">
              <p className={fin.moneyLabel}>Money now</p>
              {f.now === null || !data.inputs.money ? (
                <>
                  <p className={fin.moneyLine}>
                    Type what&rsquo;s in the bank and the cash on hand. From then on, every expense and money in you log moves it, and the weeks below show
                    what&rsquo;s left each week.
                  </p>
                  <button type="button" className={`${fin.moneyButton} ${fin.primary}`} onClick={() => setSheet({ kind: "money" })}>
                    Type the money now
                  </button>
                </>
              ) : (
                <>
                  <p className={f.now < 0 ? `${fin.moneyBig} ${fin.below}` : fin.moneyBig}>{money(f.now)}</p>
                  <p className={fin.moneyLine}>
                    You said {money(data.inputs.money.amount)} on {when(data.inputs.money.at)}
                    {data.inputs.since.count || data.inputs.since.pending
                      ? `. Since then ${money(data.inputs.since.out)} out (${data.inputs.since.count} ${data.inputs.since.count === 1 ? "entry" : "entries"})${data.inputs.since.in ? `, ${money(data.inputs.since.in)} in` : ""}${
                          data.inputs.since.pending ? `, ${money(data.inputs.since.pending)} the bank paid that's still to complete in Expenses` : ""
                        }.`
                      : ". Nothing logged since."}
                  </p>
                  <button type="button" className={fin.moneyButton} onClick={() => setSheet({ kind: "money" })}>
                    Change
                  </button>
                </>
              )}
            </section>

            {f.now !== null && (
              <p className={f.short ? `${fin.verdict} ${fin.verdictShort}` : `${fin.verdict} ${fin.verdictOk}`} role="status">
                {f.short
                  ? `Runs short on ${dayWords(f.short.date, today)} (${money(-f.short.amount)} short).${
                      f.lowest && f.lowest.amount < f.short.amount ? ` At the lowest, ${dayWords(f.lowest.date, today)}, it's ${money(-f.lowest.amount)} short: that much more money is needed to get through the ${weeks} weeks.` : ""
                    }`
                  : `Never below ${money(f.lowest?.amount ?? f.now)} in the next ${weeks} weeks${f.lowest && f.lowest.amount < f.now ? ` (lowest ${dayWords(f.lowest.date, today)})` : ""}.`}
              </p>
            )}
            {f.now !== null && <Charts f={f} now={f.now} today={today} />}

            <MoneyComing data={data} leo={f.leo} rate={f.rate} unconverted={f.unconverted} onSheet={setSheet} />

            <div className={fin.adds}>
              <button type="button" onClick={() => setSheet({ kind: "plan", plan: null, direction: "in" })}>
                + Other money coming in
              </button>
              <button type="button" onClick={() => setSheet({ kind: "plan", plan: null, direction: "out" })}>
                + Another payment
              </button>
            </div>

            {past.length > 0 && (
              <section className={fin.past} aria-label="Days gone by">
                <h2 className={styles.groupTitle}>
                  Their day has gone <span>{past.length}</span>
                </h2>
                <div className={fin.week}>
                  {past.map((p) => (
                    <button key={p.id} type="button" className={fin.item} onClick={() => setSheet({ kind: "plan", plan: p, direction: p.direction })}>
                      <span className={fin.itemText}>
                        <b>{p.what}</b>
                        <small>{p.direction === "in" ? "Did it come? Log it in Expenses, then take this off" : "Paid? Log it in Expenses, then take this off"} · {short(p.repeat === "once" ? p.date : (p.until ?? p.date))}</small>
                      </span>
                      <span className={p.direction === "in" ? fin.itemIn : fin.itemOut}>
                        {p.direction === "in" ? "+" : "−"}
                        {money(p.amount)}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <div className={fin.weeks}>
              {f.weeks.map((w, i) => (
                <section key={w.start} id={`week-${w.start}`} className={fin.week} aria-label={weekName(w, i)}>
                  <div className={fin.weekHead}>
                    <h3>{weekName(w, i)}</h3>
                    {w.close !== null && (
                      <span className={w.close < 0 ? `${fin.weekEnd} ${fin.below}` : fin.weekEnd}>
                        <b>{money(w.close)}</b>
                        <small>at the end</small>
                      </span>
                    )}
                  </div>
                  {w.items.length === 0 ? (
                    <p className={fin.weekEmpty}>Nothing in or out.</p>
                  ) : (
                    w.items.map((item) => (
                      <button key={item.key} type="button" className={fin.item} onClick={() => open(item)}>
                        <span className={fin.itemText}>
                          <b>{item.kind === "wages" ? "Wages (estimate)" : item.kind === "leo" ? "Leo (estimate)" : `${item.ref ? `${item.ref} · ` : ""}${item.what}`}</b>
                          <small>
                            {dayWords(item.date, today)}
                            {item.late ? ` · was due ${short(item.late)}` : ""}
                            {item.noDate ? " · no due date" : ""}
                            {item.kind === "order" ? " · order" : item.kind === "bill" ? " · bill" : item.kind === "plan" ? " · expected" : ""}
                            {item.kind === "plan" && f.rate && data.inputs.plans.find((p) => p.id === item.id)?.currency === "USD" ? ` · ${usd(item.amount / f.rate)}` : ""}
                          </small>
                        </span>
                        <span className={item.direction === "in" ? fin.itemIn : fin.itemOut}>
                          {item.direction === "in" ? "+" : "−"}
                          {money(item.amount)}
                        </span>
                      </button>
                    ))
                  )}
                </section>
              ))}
            </div>
            {weeks < MAX_WEEKS && (
              <button type="button" className={styles.linkButton} onClick={() => setWeeks(Math.min(MAX_WEEKS, weeks + 8))}>
                Show {Math.min(8, MAX_WEEKS - weeks)} more weeks
              </button>
            )}

            <ul className={fin.notes}>
              <li>
                {f.wages.weekly === null
                  ? "Wages: no paydays to go by yet. "
                  : f.wages.typed
                    ? `Wages: ${money(f.wages.weekly)} each Saturday, as you typed. `
                    : `Wages: about ${money(f.wages.weekly)} each Saturday, the average of the last ${f.wages.used.length} ${f.wages.used.length === 1 ? "payday" : "paydays"}. `}
                <button type="button" onClick={() => setSheet({ kind: "wages" })}>
                  Change
                </button>
              </li>
              {f.later.count > 0 && (
                <li>
                  After these weeks: {f.later.out ? `${money(f.later.out)} to pay` : ""}
                  {f.later.out && f.later.in ? " and " : ""}
                  {f.later.in ? `${money(f.later.in)} to come in` : ""} ({f.later.count} {f.later.count === 1 ? "thing" : "things"}).
                </li>
              )}
              {data.unpriced > 0 && (
                <li>
                  {data.unpriced} {data.unpriced === 1 ? "thing" : "things"} on the shopping list {data.unpriced === 1 ? "has" : "have"} no price, so {data.unpriced === 1 ? "it isn't" : "they aren't"} counted. Put
                  them on an order (Orders) to count them.
                </li>
              )}
              <li>Only the company&rsquo;s money counts: Site and Event entries, as in QuickBooks. House and Niko entries don&rsquo;t.</li>
            </ul>
          </>
        )}
      </main>

      {sheet?.kind === "money" && data && <MoneySheet data={data} onClose={() => setSheet(null)} onSave={save} />}
      {sheet?.kind === "wages" && data && f && <WagesSheet weekly={f.wages} onClose={() => setSheet(null)} onSave={save} />}
      {sheet?.kind === "plan" && data && f && (
        <PlanSheet plan={sheet.plan} direction={sheet.direction} buyer={sheet.buyer ?? null} sale={!!sheet.sale} rate={f.rate} today={today} onClose={() => setSheet(null)} onSave={save} />
      )}
      {sheet?.kind === "leo" && data && f && <LeoSheet leo={f.leo} thisWeek={data.inputs.leo.thisWeek} onClose={() => setSheet(null)} onSave={save} />}
      {sheet?.kind === "rate" && data && <RateSheet rate={data.inputs.rate} onClose={() => setSheet(null)} onSave={save} />}
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

/* ---------- the money coming in ---------- */

function MoneyComing({
  data,
  leo,
  rate,
  unconverted,
  onSheet,
}: {
  data: CashflowPage;
  leo: { weekly: number | null; typed: boolean; average: number | null; used: WageWeek[]; day: number };
  rate: number | null;
  unconverted: number;
  onSheet: (sheet: Sheet) => void;
}) {
  const plans = data.inputs.plans;
  const sales = plans.filter((p) => p.direction === "in" && p.currency === "USD" && !p.buyerId);
  const owed = data.inputs.buyers.reduce((n, b) => n + b.balanceUSD, 0);
  return (
    <section className={fin.money} aria-label="Money coming in">
      <p className={fin.moneyLabel}>Money coming in</p>
      <button type="button" className={fin.inLine} onClick={() => onSheet({ kind: "leo" })}>
        <span className={fin.itemText}>
          <b>Leo</b>
          <small>
            {leo.weekly === null
              ? "Nothing from him in the app yet: tap to say what he sends"
              : leo.typed
                ? `a week, as you typed · counted on ${WEEKDAYS[leo.day]}`
                : `a week, his last ${leo.used.length} ${leo.used.length === 1 ? "week" : "weeks"}' average · usually ${WEEKDAYS[leo.day]}`}
          </small>
        </span>
        <span className={fin.itemIn}>{leo.weekly ? `+${money(leo.weekly)}` : "Set"}</span>
      </button>
      {data.inputs.buyers.length > 0 && (
        <p className={fin.inHead}>
          Buyers · {usd(owed)} still to pay
        </p>
      )}
      {data.inputs.buyers.map((b) => {
        const plan = plans.find((p) => p.buyerId === b.id) ?? null;
        return (
          <button key={b.id} type="button" className={fin.inLine} onClick={() => onSheet({ kind: "plan", plan, direction: "in", buyer: b })}>
            <span className={fin.itemText}>
              <b>{b.name}</b>
              <small>
                {usd(b.balanceUSD)} left to pay · {plan ? planWords(plan) : "tap to say when they'll pay"}
              </small>
            </span>
            <span className={plan ? fin.itemIn : fin.inTodo}>{plan ? `+${usd(plan.amount)}` : "Plan"}</span>
          </button>
        );
      })}
      {sales.map((p) => (
        <button key={p.id} type="button" className={fin.inLine} onClick={() => onSheet({ kind: "plan", plan: p, direction: "in", sale: true })}>
          <span className={fin.itemText}>
            <b>{p.what}</b>
            <small>{planWords(p)}</small>
          </span>
          <span className={fin.itemIn}>+{usd(p.amount)}</span>
        </button>
      ))}
      <button type="button" className={fin.moneyButton} onClick={() => onSheet({ kind: "plan", plan: null, direction: "in", sale: true })}>
        + New buyers you expect
      </button>
      <p className={fin.moneyLine}>
        {rate ? `Dollars count at GH₵ ${rate} for one US$ (${data.inputs.rate.typed ? "as you typed" : "the last buyer payment's rate"}). ` : "No dollar rate yet: type one so dollars count. "}
        <button type="button" className={fin.linkInline} onClick={() => onSheet({ kind: "rate" })}>
          Change
        </button>
      </p>
      {unconverted > 0 && <p className={fin.moneyLine}>{unconverted} in dollars can&rsquo;t count until there&rsquo;s a rate.</p>}
    </section>
  );
}

/* ---------- the charts: the money at the end of each week, as expected and if no money comes in ---------- */

// Side by side (one under the other on a phone), on the same scale so a column's height means the same money in both:
// with the money expected (Leo, the buyers, the rest), and with none of it (Niko, 10 Nov 2026: "a chart next to this
// one that shows my positions if no cash comes in, in other words my entire exposure").
function Charts({ f, now, today }: { f: Forecast; now: number; today: string }) {
  const weeks = f.weeks;
  const expected = weeks.map((w) => w.close ?? 0);
  const bare = weeks.map((w) => w.closeNoIn ?? 0);
  const span: [number, number] = [Math.min(0, ...expected, ...bare), Math.max(0, ...expected, ...bare)];
  const last = weeks[weeks.length - 1].end;
  const end = f.noIn.end ?? now;
  const lowest = f.lowest?.amount ?? now;
  const pick = (start: string) => document.getElementById(`week-${start}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <div className={fin.charts}>
      <figure className={fin.chartBox}>
        <figcaption>
          <b>With the money you expect</b>
          <span className={lowest < 0 ? fin.below : undefined}>
            {lowest < 0 ? `${money(-lowest)} short at the lowest${f.lowest ? ` (${short(f.lowest.date)})` : ""}` : `Never below ${money(lowest)}`}
          </span>
          <small>Leo, the buyers and the other money in, all counted.</small>
        </figcaption>
        <WeekChart weeks={weeks} values={expected} span={span} name="The money at the end of each week, with the money you expect" tip="at the end of the week" onPick={pick} />
      </figure>
      <figure className={fin.chartBox}>
        <figcaption>
          <b>If no money comes in</b>
          <span className={end < 0 ? fin.below : undefined}>{end < 0 ? `${money(-end)} short by ${short(last)}: your whole exposure` : `${money(end)} still left on ${short(last)}`}</span>
          <small>
            {money(f.totals.out)} to pay in these {weeks.length} weeks, {money(now)} in hand
            {f.noIn.short ? `. Short from ${dayWords(f.noIn.short.date, today)}` : ""}
            {f.later.out ? `. After these weeks, ${money(f.later.out)} more to pay` : ""}.
          </small>
        </figcaption>
        <WeekChart weeks={weeks} values={bare} span={span} name="The money at the end of each week if no money comes in" tip="at the end of the week if no money comes in" onPick={pick} />
      </figure>
    </div>
  );
}

function WeekChart({
  weeks,
  values,
  span: [low, high],
  name,
  tip,
  onPick,
}: {
  weeks: CashWeek[];
  /** A figure for each week. */
  values: number[];
  /** The least and the most on the scale (both charts' together, so they read alike). */
  span: [number, number];
  name: string;
  /** What a column's figure is, after it: "at the end of the week". */
  tip: string;
  onPick: (start: string) => void;
}) {
  const W = 340;
  const H = 150;
  const left = 34;
  const right = 4;
  const top = 18;
  const bottom = 22;
  const hi = Math.max(0, high, ...values);
  const lo = Math.min(0, low, ...values);
  const span = hi - lo || 1;
  const max = hi + span * 0.12;
  const min = lo < 0 ? lo - span * 0.14 : 0;
  const y = (v: number) => top + ((max - v) / (max - min)) * (H - top - bottom);
  const band = (W - left - right) / weeks.length;
  const width = Math.min(24, band * 0.6);
  const zero = y(0);
  // Round figures for the few lines across: nothing, the highest, the lowest below nothing.
  const round = (v: number) => {
    if (v === 0) return 0;
    const step = 10 ** Math.floor(Math.log10(Math.abs(v)));
    return Math.sign(v) * Math.floor(Math.abs(v) / step) * step;
  };
  // (A line too near the one at nothing is left out: their figures would sit on each other.)
  const ticks = [...new Set([0, round(hi), ...(lo < 0 ? [round(lo)] : [])])].filter((t) => t === 0 || Math.abs(y(t) - zero) >= 12);
  const lowest = values.indexOf(Math.min(...values));
  const every = weeks.length > 8 ? 2 : 1;
  return (
    <svg className={fin.chart} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${name} (the weeks below say each in full)`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} className={t === 0 ? fin.chartZero : fin.chartGrid} />
          <text x={left - 4} y={y(t) + 3} textAnchor="end" className={fin.chartLabel}>
            {compact(t)}
          </text>
        </g>
      ))}
      {weeks.map((w, i) => {
        const v = values[i];
        const mid = left + band * i + band / 2;
        const x = mid - width / 2;
        const end = y(v);
        const r = Math.min(4, Math.abs(zero - end));
        // Square on the line at nothing, rounded at the end.
        const d =
          v >= 0
            ? `M${x},${zero}V${end + r}Q${x},${end} ${x + r},${end}H${x + width - r}Q${x + width},${end} ${x + width},${end + r}V${zero}Z`
            : `M${x},${zero}V${end - r}Q${x},${end} ${x + r},${end}H${x + width - r}Q${x + width},${end} ${x + width},${end - r}V${zero}Z`;
        const label = i === lowest || i === weeks.length - 1;
        return (
          <g key={w.start} onClick={() => onPick(w.start)} className={fin.chartColumn}>
            <title>{`${short(w.start)}–${short(w.end)}: ${money(v)} ${tip}`}</title>
            <rect x={left + band * i} y={top - 12} width={band} height={H - top - bottom + 12} fill="transparent" />
            {Math.abs(zero - end) > 0.5 && <path d={d} className={v < 0 ? fin.chartBarBelow : fin.chartBar} />}
            {label && (
              <text x={mid} y={v >= 0 ? end - 4 : end + 11} textAnchor="middle" className={fin.chartValue}>
                {compact(v)}
              </text>
            )}
            {i % every === 0 && (
              <text x={mid} y={H - 6} textAnchor="middle" className={fin.chartLabel}>
                {short(w.start)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* ---------- the sheets ---------- */

type Save = (body: Record<string, unknown>, text: string) => Promise<void>;

function SheetButtons({ saving, onClose, onSave, label }: { saving: boolean; onClose: () => void; onSave: () => void; label: string }) {
  return (
    <div className={styles.sheetButtons}>
      <button type="button" className={styles.sheetCancel} onClick={onClose} disabled={saving}>
        Cancel
      </button>
      <button type="button" className={styles.sheetSave} onClick={onSave} disabled={saving}>
        {saving ? "Saving…" : label}
      </button>
    </div>
  );
}

function MoneySheet({ data, onClose, onSave }: { data: CashflowPage; onClose: () => void; onSave: Save }) {
  const typed = data.inputs.money;
  const [bank, setBank] = useState(typed?.bank !== null && typed?.bank !== undefined ? String(typed.bank) : data.bank ? String(data.bank.balance) : "");
  const [cash, setCash] = useState(typed?.cash !== null && typed?.cash !== undefined ? String(typed.cash) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const total = (toNumber(bank) ?? 0) + (toNumber(cash) ?? 0);
  const go = async () => {
    if (!bank.trim() && !cash.trim()) return setError("Type what's in the bank, the cash on hand, or both.");
    if ((bank.trim() && toNumber(bank) === null) || (cash.trim() && toNumber(cash) === null)) return setError("Type the amounts as numbers, e.g. 120000.");
    setSaving(true);
    setError("");
    try {
      await onSave({ action: "money", bank: bank.trim() || null, cash: cash.trim() || null }, `Money now: ${money(total)}`);
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };
  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label="The money now">
        <h2 className={styles.sheetTitle}>The money now</h2>
        <p className={styles.sheetNote}>From now on every expense and money in you log moves it, so type it again only when it&rsquo;s drifted.</p>
        <label className={styles.label} htmlFor="cf-bank">
          In the bank (GH₵)
        </label>
        <input id="cf-bank" className={styles.input} inputMode="decimal" value={bank} onChange={(e) => setBank(e.target.value)} placeholder="e.g. 120000" disabled={saving} />
        {data.bank && (
          <p className={styles.sheetNote}>
            The bank&rsquo;s last text said {money(data.bank.balance)} ({short(data.bank.date)}
            {data.bank.time ? `, ${data.bank.time}` : ""}).{" "}
            {String(data.bank.balance) !== bank && (
              <button type="button" className={styles.linkButton} onClick={() => setBank(String(data.bank?.balance ?? ""))} disabled={saving}>
                Use it
              </button>
            )}
            {!data.debits && " Only money-in texts come through until the iPhone automation says Acct Num, so it may be old."}
          </p>
        )}
        <label className={styles.label} htmlFor="cf-cash">
          Cash and MoMo on hand (GH₵)
        </label>
        <input id="cf-cash" className={styles.input} inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="e.g. 8000" disabled={saving} />
        <p className={fin.total}>
          Together <b>{money(total)}</b>
        </p>
        {error && (
          <p className={styles.sheetError} role="alert">
            {error}
          </p>
        )}
        <SheetButtons saving={saving} onClose={onClose} onSave={() => void go()} label="Save" />
      </div>
    </div>
  );
}

/** What Leo sends a week: his last weeks' average, or a figure typed. */
function LeoSheet({
  leo,
  thisWeek,
  onClose,
  onSave,
}: {
  leo: { weekly: number | null; typed: boolean; average: number | null; used: WageWeek[]; day: number };
  thisWeek: number;
  onClose: () => void;
  onSave: Save;
}) {
  const [value, setValue] = useState(leo.typed && leo.weekly !== null ? String(leo.weekly) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const go = async (useAverage: boolean) => {
    const n = toNumber(value);
    if (!useAverage && !(n && n > 0)) return setError("Type what Leo sends in a week, e.g. 150000, or use the average.");
    setSaving(true);
    setError("");
    try {
      await onSave({ action: "leo", weekly: useAverage ? null : n }, useAverage ? "Leo: his last weeks' average" : `Leo: ${money(n ?? 0)} a week`);
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };
  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label="Leo's money">
        <h2 className={styles.sheetTitle}>Leo&rsquo;s money</h2>
        {leo.average !== null ? (
          <>
            <p className={styles.sheetNote}>
              His last {leo.used.length} {leo.used.length === 1 ? "week" : "weeks"} came to about <b>{money(leo.average)}</b> a week (his money in, in Expenses). It&rsquo;s counted each
              week on {WEEKDAYS[leo.day]}, the day he sends most; this week&rsquo;s less the {money(thisWeek)} that came already.
            </p>
            <ul className={fin.history}>
              {leo.used.map((w) => (
                <li key={w.week}>
                  Week of {short(w.week)}: <b>{money(w.paid)}</b>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className={styles.sheetNote}>Nothing from Leo in the app yet to go by: type what he usually sends in a week.</p>
        )}
        <label className={styles.label} htmlFor="cf-leo">
          Or a figure of your own (GH₵ a week)
        </label>
        <input id="cf-leo" className={styles.input} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 150000" disabled={saving} />
        {error && (
          <p className={styles.sheetError} role="alert">
            {error}
          </p>
        )}
        {leo.typed && leo.average !== null && (
          <button type="button" className={styles.linkButton} onClick={() => void go(true)} disabled={saving}>
            Use his average again ({money(leo.average)})
          </button>
        )}
        <SheetButtons saving={saving} onClose={onClose} onSave={() => void go(false)} label="Use this figure" />
      </div>
    </div>
  );
}

/** The dollar rate dollars count at: the last buyer payment's, or one typed. */
function RateSheet({ rate, onClose, onSave }: { rate: { typed: number | null; last: number | null }; onClose: () => void; onSave: Save }) {
  const [value, setValue] = useState(rate.typed !== null ? String(rate.typed) : rate.last !== null ? String(rate.last) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const go = async (useLast: boolean) => {
    const n = toNumber(value);
    if (!useLast && !(n && n > 0.5)) return setError("Type the rate as GH₵ for one US$, e.g. 11.7.");
    setSaving(true);
    setError("");
    try {
      await onSave({ action: "rate", rate: useLast ? null : n }, useLast ? "Dollars count at the last buyer payment's rate" : `Dollars count at GH₵ ${n}`);
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };
  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label="The dollar rate">
        <h2 className={styles.sheetTitle}>The dollar rate</h2>
        <p className={styles.sheetNote}>
          What one US$ counts as in the cash flow{rate.last !== null ? `; the last buyer payment in cedis was at GH₵ ${rate.last}` : ""}.
        </p>
        <label className={styles.label} htmlFor="cf-rate">
          GH₵ for one US$
        </label>
        <input id="cf-rate" className={styles.input} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 11.7" disabled={saving} />
        {error && (
          <p className={styles.sheetError} role="alert">
            {error}
          </p>
        )}
        {rate.typed !== null && rate.last !== null && (
          <button type="button" className={styles.linkButton} onClick={() => void go(true)} disabled={saving}>
            Use the last buyer payment&rsquo;s (GH₵ {rate.last})
          </button>
        )}
        <SheetButtons saving={saving} onClose={onClose} onSave={() => void go(false)} label="Use this rate" />
      </div>
    </div>
  );
}

function WagesSheet({
  weekly,
  onClose,
  onSave,
}: {
  weekly: { weekly: number | null; typed: boolean; average: number | null; used: Array<{ week: string; paid: number }> };
  onClose: () => void;
  onSave: Save;
}) {
  const [value, setValue] = useState(weekly.typed && weekly.weekly !== null ? String(weekly.weekly) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const go = async (useAverage: boolean) => {
    const n = toNumber(value);
    if (!useAverage && !(n && n > 0)) return setError("Type the wages for a week, e.g. 25000, or use the average.");
    setSaving(true);
    setError("");
    try {
      await onSave({ action: "wages", weekly: useAverage ? null : n }, useAverage ? "Wages: the paydays' average" : `Wages: ${money(n ?? 0)} each Saturday`);
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };
  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label="The wages each week">
        <h2 className={styles.sheetTitle}>Wages each Saturday</h2>
        {weekly.average !== null ? (
          <>
            <p className={styles.sheetNote}>
              The last {weekly.used.length} {weekly.used.length === 1 ? "payday" : "paydays"} came to about <b>{money(weekly.average)}</b> a week (the roll call&rsquo;s Payday, wages and the steel
              machines). This week&rsquo;s counts less what it has paid already.
            </p>
            <ul className={fin.history}>
              {weekly.used.map((w) => (
                <li key={w.week}>
                  Week of {short(w.week)}: <b>{money(w.paid)}</b>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className={styles.sheetNote}>No paydays in the app yet to go by: type what a week usually comes to.</p>
        )}
        <label className={styles.label} htmlFor="cf-wages">
          Or a figure of your own (GH₵ a week)
        </label>
        <input id="cf-wages" className={styles.input} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 30000" disabled={saving} />
        {error && (
          <p className={styles.sheetError} role="alert">
            {error}
          </p>
        )}
        {weekly.typed && weekly.average !== null && (
          <button type="button" className={styles.linkButton} onClick={() => void go(true)} disabled={saving}>
            Use the average again ({money(weekly.average)})
          </button>
        )}
        <SheetButtons saving={saving} onClose={onClose} onSave={() => void go(false)} label="Use this figure" />
      </div>
    </div>
  );
}

function PlanSheet({
  plan,
  direction: first,
  buyer,
  sale,
  rate,
  today,
  onClose,
  onSave,
}: {
  plan: CashPlan | null;
  direction: "in" | "out";
  /** A buyer's payments: theirs, in dollars, counted until what they owe is paid. */
  buyer: CashBuyer | null;
  /** New buyers' money expected: in dollars to start with. */
  sale: boolean;
  rate: number | null;
  today: string;
  onClose: () => void;
  onSave: Save;
}) {
  const [direction, setDirection] = useState<"in" | "out">(buyer || sale ? "in" : (plan?.direction ?? first));
  const [what, setWhat] = useState(plan?.what ?? (buyer ? buyer.name : sale ? "New buyers" : ""));
  const [currency, setCurrency] = useState<Currency>(plan?.currency ?? (buyer || sale ? "USD" : "GHS"));
  const [amount, setAmount] = useState(plan ? String(plan.amount) : "");
  const [date, setDate] = useState(plan?.date ?? today);
  const [repeat, setRepeat] = useState<Repeat>(plan?.repeat ?? (buyer || sale ? "month" : "once"));
  const [until, setUntil] = useState(plan?.until ?? "");
  const [saving, setSaving] = useState(false);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState("");
  const go = async () => {
    const n = toNumber(amount);
    if (!what.trim()) return setError(direction === "in" ? "Say who it's from, e.g. Leo." : "Say what it's for, e.g. Security guard.");
    if (!(n && n > 0)) return setError("Type the amount.");
    setSaving(true);
    setError("");
    try {
      await onSave(
        {
          action: "plan",
          ...(plan ? { id: plan.id } : {}),
          direction,
          what: what.trim(),
          amount: n,
          date,
          repeat,
          until: repeat !== "once" && until && !buyer ? until : null,
          currency,
          buyerId: buyer?.id ?? null,
        },
        `${direction === "in" ? "Coming in" : "To pay"}: ${what.trim()} ${inMoney(n, currency)}${repeat === "once" ? ` on ${short(date)}` : `, ${REPEAT_WORDS[repeat].toLowerCase()}`}`
      );
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!plan) return;
    if (!armed) return setArmed(true);
    setSaving(true);
    try {
      await onSave({ action: "deleteplan", id: plan.id }, `${plan.what} taken off`);
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };
  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label={buyer ? `${buyer.name}'s payments` : sale ? "New buyers you expect" : direction === "in" ? "Money coming in" : "A payment to come"}>
        <h2 className={styles.sheetTitle}>{buyer ? `${buyer.name}'s payments` : sale ? "New buyers you expect" : direction === "in" ? "Money coming in" : "A payment to come"}</h2>
        {buyer ? (
          <p className={styles.sheetNote}>
            {usd(buyer.balanceUSD)} left to pay. Say what they pay and when: it counts until that&rsquo;s paid, and each payment logged on the Buyers tab takes it down.
          </p>
        ) : sale ? (
          <p className={styles.sheetNote}>Sales you expect: e.g. a reservation fee or a deposit from new buyers each month.</p>
        ) : (
          <div className={styles.chips}>
            {(["in", "out"] as const).map((d) => (
              <button key={d} type="button" className={direction === d ? styles.chipOn : styles.chip} aria-pressed={direction === d} onClick={() => setDirection(d)} disabled={saving}>
                {d === "in" ? "Money in" : "A payment"}
              </button>
            ))}
          </div>
        )}
        {!buyer && (
          <>
            <label className={styles.label} htmlFor="cf-what">
              {direction === "in" ? "From whom" : "What for"}
            </label>
            <input id="cf-what" className={styles.input} value={what} onChange={(e) => setWhat(e.target.value)} maxLength={80} placeholder={direction === "in" ? "e.g. Leo" : "e.g. Security guard"} disabled={saving} />
          </>
        )}
        {!buyer && (
          <div className={styles.chips}>
            {(["GHS", "USD"] as const).map((c) => (
              <button key={c} type="button" className={currency === c ? styles.chipOn : styles.chip} aria-pressed={currency === c} onClick={() => setCurrency(c)} disabled={saving}>
                {c === "GHS" ? "GH₵" : "US$"}
              </button>
            ))}
          </div>
        )}
        <label className={styles.label} htmlFor="cf-amount">
          Amount ({currency === "USD" ? "US$" : "GH₵"}){buyer ? " each time" : ""}
        </label>
        <input id="cf-amount" className={styles.input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={currency === "USD" ? "e.g. 2000" : "e.g. 50000"} disabled={saving} />
        {currency === "USD" && toNumber(amount) && rate ? <p className={styles.sheetNote}>About {money((toNumber(amount) ?? 0) * rate)} at GH₵ {rate}.</p> : null}
        <label className={styles.label} htmlFor="cf-date">
          {repeat === "once" ? "When" : "From"}
        </label>
        <input id="cf-date" className={styles.input} type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} disabled={saving} />
        <div className={styles.chips}>
          {(
            [
              ["Today", 0],
              ["In a week", 7],
              ["In 2 weeks", 14],
              ["In a month", 30],
            ] as const
          ).map(([label, n]) => (
            <button key={label} type="button" className={date === addDays(today, n) ? styles.chipOn : styles.chip} onClick={() => setDate(addDays(today, n))} disabled={saving}>
              {label}
            </button>
          ))}
        </div>
        <span className={styles.label}>How often</span>
        <div className={styles.chips}>
          {REPEATS.map((r) => (
            <button key={r} type="button" className={repeat === r ? styles.chipOn : styles.chip} aria-pressed={repeat === r} onClick={() => setRepeat(r)} disabled={saving}>
              {REPEAT_WORDS[r]}
            </button>
          ))}
        </div>
        {repeat !== "once" && !buyer && (
          <>
            <label className={styles.label} htmlFor="cf-until">
              Until (optional)
            </label>
            <input id="cf-until" className={styles.input} type="date" value={until} min={date} onChange={(e) => setUntil(e.target.value)} disabled={saving} />
          </>
        )}
        {error && (
          <p className={styles.sheetError} role="alert">
            {error}
          </p>
        )}
        {plan && (
          <button type="button" className={armed ? `${styles.linkButton} ${styles.dangerArmed}` : styles.linkButton} onClick={() => void remove()} disabled={saving}>
            {armed ? "Tap again to take it off" : "Take it off"}
          </button>
        )}
        <SheetButtons saving={saving} onClose={onClose} onSave={() => void go()} label={plan ? "Save" : "Add it"} />
      </div>
    </div>
  );
}
