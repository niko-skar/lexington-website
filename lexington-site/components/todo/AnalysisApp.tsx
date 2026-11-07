"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { GROUPS, isMaterialGroup, type AnalysisData, type MaterialBuy, type MaterialRow } from "@/lib/analysis/shared";
import { REVIEW } from "@/lib/analysis/review";
import { money } from "@/lib/expenses/shared";
import type { TodoMe } from "@/lib/todo/shared";
import an from "./Analysis.module.css";
import { AccessSheet } from "./AccessSheet";
import { startPolling } from "./api";
import { SiteHeader, SiteMenu } from "./SiteChrome";
import sp from "./Spending.module.css";
import styles from "./Todo.module.css";

// Analysis (lib/analysis/shared.ts says what and why): Claude's review of how it's going, the numbers behind it (kept
// up to date), what looks counted twice, and every material bought, counted; tap a material for its purchases.

type View = "review" | "materials";
const VIEW_NAMES: Record<View, string> = { review: "How it's going", materials: "Materials bought" };

const day = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: y === new Date().getFullYear() ? undefined : "numeric", timeZone: "UTC" });
};
const plusDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const monthName = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
/** GH₵ 1.28M, GH₵ 385k, GH₵ 520: for the bars. */
const short = (n: number) =>
  Math.abs(n) >= 1_000_000 ? `GH₵ ${(n / 1_000_000).toFixed(2)}M` : Math.abs(n) >= 10_000 ? `GH₵ ${Math.round(n / 1000)}k` : `GH₵ ${Math.round(n).toLocaleString("en-GB")}`;
const UNIT_WORDS: Record<string, [string, string]> = {
  pcs: ["piece", "pieces"],
  bags: ["bag", "bags"],
  tons: ["ton", "tons"],
  rolls: ["roll", "rolls"],
  boxes: ["box", "boxes"],
  "truck loads": ["truck load", "truck loads"],
};
const count = (n: number, unit: string) => `${n.toLocaleString("en-GB", { maximumFractionDigits: 2 })} ${UNIT_WORDS[unit]?.[n === 1 ? 0 : 1] ?? unit}`;
const each = (unit: string) => (unit === "m³" ? "a m³" : `a ${UNIT_WORDS[unit]?.[0] ?? unit}`);
/** An entry as the office knows it: its app number, else QuickBooks' kind and number. */
const entryName = (entry: string, ref: string | null) => {
  if (ref) return ref;
  const [source, type, id] = entry.split(":");
  if (source !== "qbo") return "the app's entry";
  return `QuickBooks ${type === "Bill" ? "bill" : type === "VendorCredit" ? "credit" : "expense"} ${id}`;
};

export function AnalysisApp({
  me,
  active,
  initial,
  startedOffline,
  fresh,
  tabs,
}: {
  me: TodoMe;
  active: boolean;
  initial: AnalysisData | null;
  startedOffline: boolean;
  fresh: boolean;
  /** Finance's tabs, under the header. */
  tabs?: React.ReactNode;
}) {
  const [data, setData] = useState<AnalysisData | null>(initial);
  const [offline, setOffline] = useState(startedOffline);
  const [signedOut, setSignedOut] = useState(false);
  const [view, setView] = useState<View>("review");
  const [open, setOpen] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const inFlight = useRef(false);
  const lastLoadedAt = useRef(0);
  const skipFirst = useRef(fresh);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await fetch("/api/analysis", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        setSignedOut(true);
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      setData((await response.json()) as AnalysisData);
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

  const material = useMemo(() => data?.materials.find((m) => m.key === open) ?? null, [data, open]);
  const sub = !data ? "Loading…" : `${money(data.spent)} spent${data.first ? ` since ${day(data.first)}` : ""}`;

  return (
    <>
      <SiteHeader eyebrow={tabs ? "Finance" : undefined} title="Analysis" sub={sub} onMenu={() => setMenuOpen(true)}>
        {tabs}
      </SiteHeader>
      {signedOut && (
        <div className={styles.banner} role="alert">
          You&rsquo;ve been signed out. <a href="/todo/analysis">Sign in again</a>
        </div>
      )}
      {offline && !signedOut && (
        <div className={styles.banner} role="status">
          No signal: showing the analysis as it was.
        </div>
      )}

      <main className={styles.main}>
        {!data ? (
          <p className={styles.loading}>Working out the analysis…</p>
        ) : material ? (
          <MaterialPage row={material} onBack={() => setOpen(null)} />
        ) : (
          <>
            <div className={`${styles.tabs} ${an.views}`} role="tablist" aria-label="Analysis">
              {(Object.keys(VIEW_NAMES) as View[]).map((v) => (
                <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? styles.tabOn : styles.tab} onClick={() => setView(v)}>
                  {VIEW_NAMES[v]}
                </button>
              ))}
            </div>
            {view === "review" ? <Review data={data} /> : <Materials data={data} onOpen={setOpen} />}
          </>
        )}
      </main>

      {menuOpen && <SiteMenu me={me} onClose={() => setMenuOpen(false)} onRefresh={() => void refresh()} onLogins={() => setAccessOpen(true)} />}
      {accessOpen && <AccessSheet onClose={() => setAccessOpen(false)} />}
    </>
  );
}

/* ---------- how it's going ---------- */

function Review({ data }: { data: AnalysisData }) {
  const totalGroups = data.groups.reduce((n, g) => n + g.amount, 0);
  const biggestGroup = Math.max(1, ...data.groups.map((g) => g.amount));
  const biggestFloor = Math.max(1, ...data.floors.map((f) => f.amount));
  const biggestMonth = Math.max(1, ...data.months.map((m) => m.amount));
  const biggestWeek = Math.max(1, ...data.weeks.flatMap((w) => [w.spent, w.in]));
  const cash = data.cash;
  return (
    <>
      <section className={an.review} aria-label="Claude's review">
        <p className={sp.cardName}>Claude&rsquo;s review · {day(REVIEW.date)}</p>
        <ol className={an.points}>
          {REVIEW.points.map((p) => (
            <li key={p.title}>
              <b>{p.title}</b>
              <span>{p.text}</span>
            </li>
          ))}
        </ol>
        <p className={an.small}>Written from the books on {day(REVIEW.date)}. The numbers below update themselves.</p>
      </section>

      {(data.doubles.length > 0 || data.gaps.length > 0) && (
        <>
          <h2 className={styles.groupTitle}>Worth checking</h2>
          <div className={sp.checks}>
            {data.doubles.map((d) => (
              <div key={`${d.a.entry}|${d.b.entry}`} className={sp.check}>
                <b>
                  {d.a.supplier || d.b.supplier || "A supplier"} · {money(d.amount)}
                </b>
                <small>
                  A bill ({entryName(d.a.entry, d.a.ref)}, {day(d.a.date)}) and an expense ({entryName(d.b.entry, d.b.ref)}, {day(d.b.date)}) for the same amount. If
                  the expense paid the bill, it&rsquo;s counted twice.
                </small>
              </div>
            ))}
            {data.gaps.map((g) => (
              <div key={g.from} className={sp.check}>
                <b>
                  Nothing recorded from {day(plusDays(g.from, 1))} to {day(plusDays(g.to, -1))}
                </b>
                <small>{g.days} days with no spending at all: if money went out then, it isn&rsquo;t in the books.</small>
              </div>
            ))}
          </div>
        </>
      )}

      {data.since && (
        <>
          <h2 className={styles.groupTitle}>Since {day(data.since.from)}</h2>
          <section className={an.inOut} aria-label={`Money in and out since ${day(data.since.from)}`}>
            <div>
              <small>Came in</small>
              <b>{money(data.since.in)}</b>
              <small>
                Leo {money(data.since.leo)}
                {data.since.buyers ? ` · buyers ${money(data.since.buyers)}` : ""}
              </small>
            </div>
            <div>
              <small>Went out</small>
              <b>{money(data.since.spent)}</b>
              <small>{data.since.in >= data.since.spent ? `${money(data.since.in - data.since.spent)} less than came in` : `${money(data.since.spent - data.since.in)} more than came in`}</small>
            </div>
          </section>
          <div className={an.legend} aria-hidden="true">
            <span className={an.keyOut}>Out</span>
            <span className={an.keyIn}>In</span>
          </div>
          <ul className={an.weeks} aria-label="Week by week">
            {[...data.weeks].reverse().map((w) => (
              <li key={w.start}>
                <span className={an.weekName}>{day(w.start)}</span>
                <span className={an.weekBars}>
                  <span className={an.barLine}>
                    <span className={an.barOut} style={{ width: `${(w.spent / biggestWeek) * 100}%` }} />
                    <small>
                      out {short(w.spent)}
                      {w.big ? ` (steel & concrete ${short(w.big)})` : ""}
                    </small>
                  </span>
                  <span className={an.barLine}>
                    <span className={an.barIn} style={{ width: `${(w.in / biggestWeek) * 100}%` }} />
                    <small>
                      in {short(w.in)}
                      {w.buyers ? ` (buyers ${short(w.buyers)})` : ""}
                    </small>
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className={sp.note}>Weeks start on Monday. Money in is counted from when the app began keeping it.</p>
        </>
      )}

      {cash && cash.now !== null && (
        <section className={sp.card} aria-label="Cash flow">
          <p className={sp.cardName}>Cash flow</p>
          <p className={sp.big}>{money(cash.now)}</p>
          <p className={sp.line}>
            now{cash.typedAt ? ` (typed ${day(cash.typedAt.slice(0, 10))}, moved on by each entry since)` : ""}
            {cash.leoWeekly ? ` · Leo ${money(cash.leoWeekly)} a week` : ""}
            {cash.wagesWeekly ? ` · wages ${money(cash.wagesWeekly)} a week` : ""}
          </p>
          <p className={cash.short ? an.warn : sp.line}>
            {cash.short
              ? `Runs short on ${day(cash.short.date)} by ${money(Math.abs(cash.short.amount))}, as the Cash flow tab has it.`
              : cash.lowest
                ? `Doesn't run short in the weeks ahead: at its lowest ${money(cash.lowest.amount)} on ${day(cash.lowest.date)}.`
                : "Doesn't run short in the weeks ahead."}
          </p>
        </section>
      )}

      <h2 className={styles.groupTitle}>Where the money went</h2>
      <div className={sp.rows}>
        {data.groups.map((g) => (
          <div key={g.name} className={sp.row}>
            <span className={sp.bar} style={{ width: `${Math.max(0, (g.amount / biggestGroup) * 100)}%` }} aria-hidden="true" />
            <span className={sp.rowText}>
              <b>{g.name}</b>
              <small>
                {g.count} {g.count === 1 ? "line" : "lines"}
                {totalGroups ? ` · ${Math.round((g.amount / totalGroups) * 100)}%` : ""}
              </small>
            </span>
            <span className={sp.amount}>{money(g.amount)}</span>
          </div>
        ))}
      </div>

      <h2 className={styles.groupTitle}>By floor or stage</h2>
      <div className={sp.rows}>
        {data.floors.map((f) => (
          <div key={f.name} className={sp.row}>
            <span className={sp.bar} style={{ width: `${Math.max(0, (f.amount / biggestFloor) * 100)}%` }} aria-hidden="true" />
            <span className={sp.rowText}>
              <b>{f.name}</b>
              <small>{data.spent ? `${Math.round((f.amount / data.spent) * 100)}%` : ""}</small>
            </span>
            <span className={sp.amount}>{money(f.amount)}</span>
          </div>
        ))}
      </div>

      <h2 className={styles.groupTitle}>Month by month</h2>
      <div className={an.legend} aria-hidden="true">
        <span className={an.keyBig}>Steel &amp; concrete</span>
        <span className={an.keyRest}>Everything else</span>
      </div>
      <ul className={an.months} aria-label="Month by month">
        {[...data.months].reverse().map((m) => (
          <li key={m.month}>
            <span className={an.weekName}>{monthName(m.month)}</span>
            <span className={an.monthBar}>
              <span className={an.barBig} style={{ width: `${(m.big / biggestMonth) * 100}%` }} />
              <span className={an.barRest} style={{ width: `${(Math.max(0, m.amount - m.big) / biggestMonth) * 100}%` }} />
            </span>
            <b>{m.amount ? short(m.amount) : "nothing"}</b>
          </li>
        ))}
      </ul>

      {data.prices.length > 0 && (
        <>
          <h2 className={styles.groupTitle}>Prices then and now</h2>
          <ul className={an.prices}>
            {data.prices.map((p) => (
              <li key={p.key}>
                <span>
                  <b>{p.name}</b>
                  <small>
                    {each(p.unit)}: {day(p.firstDate)} to {day(p.lastDate)}
                  </small>
                </span>
                <span className={an.priceNow}>
                  {money(p.first).replace(".00", "")} → {money(p.last).replace(".00", "")}
                  <small className={Math.abs(p.change) < 3 ? undefined : p.change > 0 ? an.up : an.down}>
                    {Math.abs(p.change) < 3 ? "about the same" : `${p.change > 0 ? "▲ up" : "▼ down"} ${Math.abs(Math.round(p.change))}%`}
                  </small>
                </span>
              </li>
            ))}
          </ul>
          <p className={sp.note}>The first three purchases with a number written against the last three.</p>
        </>
      )}
      <p className={sp.note}>
        {data.connected
          ? data.fetchedAt
            ? `From QuickBooks as read ${day(data.fetchedAt.slice(0, 10))} ${new Date(data.fetchedAt).toISOString().slice(11, 16)}, and the app's own entries not there yet.`
            : "QuickBooks hasn't been read yet: only the app's own entries are here."
          : "QuickBooks isn't connected: only the app's own entries are here."}
      </p>
    </>
  );
}

/* ---------- materials ---------- */

function Materials({ data, onOpen }: { data: AnalysisData; onOpen: (key: string) => void }) {
  if (!data.materials.length) return <p className={styles.empty}>No materials bought yet.</p>;
  return (
    <>
      <p className={sp.note}>
        Counted from what was typed in the app (material and quantity) and written in QuickBooks (&ldquo;Kalushia 150pcs 2x4&rdquo;). Where no number was written, the money is
        shown with about how many that is at the average price. Tap one for its purchases.
      </p>
      {GROUPS.filter(isMaterialGroup).map((g) => {
        const rows = data.materials.filter((m) => m.group === g);
        if (!rows.length) return null;
        return (
          <section key={g} aria-label={g}>
            <h2 className={styles.groupTitle}>{g}</h2>
            <div className={sp.rows}>
              {rows.map((m) => (
                <button key={m.key} type="button" className={sp.row} onClick={() => onOpen(m.key)}>
                  <span className={sp.rowText}>
                    <b>{m.name}</b>
                    <small>
                      {money(m.money)}
                      {m.price ? ` · ${money(m.price)} ${each(m.unit)}` : ""}
                    </small>
                    {m.unknownMoney > 0 && (
                      <small>
                        + {money(m.unknownMoney)} with no number written{m.estimate ? ` (about ${count(m.estimate, m.unit)})` : ""}
                      </small>
                    )}
                  </span>
                  <span className={m.count ? an.count : sp.amountNone}>{m.count ? count(m.count, m.unit) : "no count"}</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}

function buyWords(b: MaterialBuy, unit: string): string {
  if (b.partOf) return `${b.count !== null ? count(b.count, unit) : ""}: the same goods paid in parts, counted once`;
  if (b.count === 0) return "a payment for goods counted before";
  if (b.count === null) return "no number written";
  return count(b.count, unit);
}

function MaterialPage({ row, onBack }: { row: MaterialRow; onBack: () => void }) {
  return (
    <>
      <button type="button" className={sp.back} onClick={onBack}>
        ‹ Materials
      </button>
      <section className={sp.card} aria-label={row.name}>
        <p className={sp.cardName}>{row.name}</p>
        <p className={sp.big}>{row.count ? count(row.count, row.unit) : "No count written"}</p>
        <p className={sp.line}>
          {money(row.money)} in {row.buys.length} {row.buys.length === 1 ? "purchase" : "purchases"}
          {row.price ? ` · on average ${money(row.price)} ${each(row.unit)}` : ""}
        </p>
        {row.unknownMoney > 0 && (
          <p className={sp.line}>
            {money(row.unknownMoney)} of it with no number written{row.estimate ? `: about ${count(row.estimate, row.unit)} more at the average price` : ""}.
          </p>
        )}
      </section>
      <ul className={sp.entries}>
        {[...row.buys].reverse().map((b, i) => (
          <li key={`${b.entry}|${i}`}>
            <span className={sp.entryMain}>
              <span className={sp.entryWhat}>
                {day(b.date)} · {b.supplier || "no supplier"}
              </span>
              <b>{b.amount || !b.with.length ? money(b.amount) : `money with ${b.with[0]}`}</b>
            </span>
            <span>{buyWords(b, row.unit)}</span>
            <small>
              {b.text}
              {b.with.length ? ` (with ${b.with.join(", ")})` : ""}
            </small>
          </li>
        ))}
      </ul>
    </>
  );
}
