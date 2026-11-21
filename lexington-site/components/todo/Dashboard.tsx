"use client";

import { Suspense, use, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import type { DashboardData, SlotCount } from "@/lib/dashboard/server";
import { isPageSection, sectionHref, type Section, type TodoMe } from "@/lib/todo/shared";
import { AccessSheet } from "./AccessSheet";
import type { RollcallTab } from "./rollcallTab";
import { startPolling } from "./api";
import home from "./Dashboard.module.css";
import { SiteHeader, SiteMenu, type View } from "./SiteChrome";
import styles from "./Todo.module.css";

// The site app's home page (Niko, 30 Oct 2026: "the site to do app will open to the dashboard page then I
// click into what information I want to put in"): one tile per part this login opens, saying how it stands
// today. A tap opens the part; the roll call's tiles open its own page on the right tab.

// key: when a part has two tiles (the store and its shopping list); tab: the part's tab the tile opens.
type Tile = { section: Section; key?: string; tab?: "buy"; name: string; big: string; small?: string; tone?: "warn" | "ok" };

const money = (n: number) => `GH₵ ${Math.round(n).toLocaleString("en-GH")}`;
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
const shortDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
/** "Fri 13 Nov". */
const weekDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

function rollcallTile(r: NonNullable<DashboardData["rollcall"]>): Tile {
  // The latest check that has marks, else "not marked yet".
  const slots: Array<[string, SlotCount]> = [
    ["closing", r.closing],
    ["afternoon", r.afternoon],
    ["morning", r.morning],
  ];
  const latest = slots.find(([, s]) => s.marked > 0);
  const pours = [r.curing ? `${r.curing} ${r.curing === 1 ? "pour" : "pours"} curing` : "", r.checklists ? `${r.checklists} pour ${r.checklists === 1 ? "checklist" : "checklists"} open` : ""]
    .filter(Boolean)
    .join(" · ");
  return latest
    ? { section: "rollcall", name: "Roll call", big: `${latest[1].here} here`, small: [`at the ${latest[0]} check`, pours].filter(Boolean).join(" · "), tone: "ok" }
    : { section: "rollcall", name: "Roll call", big: "Not marked yet", small: [`${r.onBooks} on the books`, pours].filter(Boolean).join(" · "), tone: "warn" };
}

function tiles(d: DashboardData, unread: number): Tile[] {
  const out: Tile[] = [];
  if (d.rollcallMoving) out.push({ section: "rollcall", name: "Roll call", big: "Moving in", small: "on Sunday morning; until then, the Site Roll Call page" });
  if (d.rollcall) out.push(rollcallTile(d.rollcall));
  // Payday and Workers open from the roll call's own tabs: a tile only for a login without the roll call.
  if (d.payday && !d.rollcall) {
    const p = d.payday;
    out.push(
      p.worked
        ? { section: "payday", name: "Payday", big: `${p.paid} of ${p.worked} paid`, small: `pay week from ${shortDay(p.weekStart)}`, tone: p.paid >= p.worked ? "ok" : undefined }
        : { section: "payday", name: "Payday", big: "Nothing to pay yet", small: `pay week from ${shortDay(p.weekStart)}` }
    );
  }
  if (d.todo) {
    const t = d.todo;
    out.push({
      section: "todo",
      name: "To-do",
      big: `${t.open} to do`,
      small: [`${t.urgent} urgent · ${t.doneToday} done today`, t.house ? `${t.house} on the house list` : ""].filter(Boolean).join(" · "),
      tone: t.urgent ? "warn" : undefined,
    });
  }
  if (d.store) {
    const s = d.store;
    const outNow = `${s.toolsOut} ${s.toolsOut === 1 ? "tool" : "tools"} out`;
    out.push({
      section: "store",
      name: "Store",
      big: s.toCheck ? `${s.toCheck} new to check` : s.toFix ? `${s.toFix} ${s.toFix === 1 ? "tool" : "tools"} to fix` : outNow,
      small: [
        s.deliveries ? `${s.deliveries} ${s.deliveries === 1 ? "delivery" : "deliveries"} to tick` : "",
        s.toCheck && s.toFix ? `${s.toFix} to fix` : "",
        s.atRepairer ? `${s.atRepairer} at the repairer` : "",
        s.toCheck || s.toFix ? outNow : "",
        s.opened ? `opened ${clock(s.opened)}${s.closed ? `, closed ${clock(s.closed)}` : ""}` : "not opened today",
      ]
        .filter(Boolean)
        .join(" · "),
      tone: s.toCheck || s.toFix ? "warn" : undefined,
    });
    // The shopping list (Niko, 5 Nov 2026: "whenever I'm at the hardware store I can see what's required"): its own
    // tile, straight onto the list.
    const more = s.toBuy > s.buyNames.length ? "…" : "";
    out.push({
      key: "shopping",
      section: "store",
      tab: "buy",
      name: "To buy",
      big: s.toBuy ? `${s.toBuy} to buy` : "Nothing to buy",
      small: s.toBuy
        ? [s.buyToday ? `${s.buyToday} needed today` : "", `${s.buyNames.join(", ")}${more}`].filter(Boolean).join(" · ")
        : "add what's needed in the store room: it shows here for the shop",
      tone: s.buyToday ? "warn" : undefined,
    });
  }
  if (d.workers && !d.rollcall) out.push({ section: "workers", name: "Workers", big: `${d.workers.active} on the books`, small: "names, numbers, ID photos" });
  // Concrete: a pour day's trucks as they come; any other day, the next pour booked: its day and the m³ ordered
  // (Niko, 9 Nov 2026), what it is, and whether its order went to the concrete company.
  if (d.concrete) {
    const c = d.concrete;
    const m3 = (v: number) => `${Math.round(v * 10) / 10} m³`;
    const load = `${c.trucks} ${c.trucks === 1 ? "truck" : "trucks"} · ${m3(c.volume)}`;
    const n = c.next ?? null;
    const tomorrow = nextDay(d.today);
    if (c.day === d.today) {
      out.push({
        section: "concrete",
        name: "Concrete",
        big: load,
        small: [c.ordered ? `of ${m3(c.ordered)} ordered` : "", c.flagged ? `${c.flagged} to look at` : "all on time today"].filter(Boolean).join(" · "),
        tone: c.flagged ? "warn" : "ok",
      });
    } else if (n) {
      const when = n.day === d.today ? "Today" : n.day === tomorrow ? "Tomorrow" : weekDay(n.day);
      // The day and the m³ each stay in one piece on a phone (it wraps between them).
      const whole = (s: string) => s.replace(/ /g, " ");
      out.push({
        section: "concrete",
        name: "Concrete",
        big: `${whole(when)} · ${whole(n.volume ? m3(n.volume) : "m³ not set")}`,
        small: [n.what.join(" + "), n.mix, n.sent ? "order sent" : "order not sent yet"].filter(Boolean).join(" · "),
        tone: !n.sent && n.day <= tomorrow ? "warn" : undefined,
      });
    } else {
      out.push({ section: "concrete", name: "Concrete", big: "No pour booked", small: c.day ? `last pour ${shortDay(c.day)}: ${load}` : "book the next pour in Concrete" });
    }
  }
  // What's spent is the Spending tile's (and Expenses is on the bar): this one only while the bank's payments wait to be
  // completed there.
  if (d.expenses && d.expenses.fromBank > 0) {
    const x = d.expenses;
    out.push({
      section: "expenses",
      name: "Expenses",
      big: `${x.fromBank} from the bank to complete`,
      small: `${money(x.monthOut)} logged on site this month · ${x.monthCount} ${x.monthCount === 1 ? "entry" : "entries"}`,
      tone: "warn",
    });
  }
  // The cash flow (5 Nov 2026): the money now and whether it runs short in the weeks ahead.
  if (d.cashflow) {
    const x = d.cashflow;
    const wages = x.weekly ? `wages about ${money(x.weekly)} each Saturday` : "";
    out.push(
      x.now === null
        ? { section: "cashflow", name: "Cash flow", big: "Type the money now", small: "then the weeks ahead: wages, bills, orders", tone: "warn" }
        : x.short
          ? {
              section: "cashflow",
              name: "Cash flow",
              big: `Short ${money(-x.short.amount)} by ${shortDay(x.short.date)}`,
              small: [`${money(x.now)} now`, wages].filter(Boolean).join(" · "),
              tone: "warn",
            }
          : {
              section: "cashflow",
              name: "Cash flow",
              big: `${money(x.now)} now`,
              small: [`never below ${money(x.lowest?.amount ?? x.now)} in 8 weeks`, wages].filter(Boolean).join(" · "),
              tone: "ok",
            }
    );
  }
  // Tax & filings (21 Nov 2026): what's late, else the next return, else the company's set-up still to do.
  if (d.filings) {
    const x = d.filings;
    const name = (title: string) => title.split(" · ")[0];
    const setup = x.setupLeft ? `${x.setupLeft} set-up ${x.setupLeft === 1 ? "task" : "tasks"} left` : "";
    out.push(
      x.late
        ? { section: "filings", name: "Tax & filings", big: `${x.late} late`, small: [x.next ? `next: ${name(x.next.title)}` : "", setup].filter(Boolean).join(" · "), tone: "warn" }
        : x.next
          ? {
              section: "filings",
              name: "Tax & filings",
              big: x.next.days <= 0 ? `${name(x.next.title)} today` : `${name(x.next.title)} in ${x.next.days} ${x.next.days === 1 ? "day" : "days"}`,
              small: [`by ${shortDay(x.next.by)}`, setup].filter(Boolean).join(" · "),
              tone: x.next.days <= 7 || x.setupSoon ? "warn" : "ok",
            }
          : { section: "filings", name: "Tax & filings", big: setup || "Nothing due", tone: x.setupSoon ? "warn" : "ok" }
    );
  }
  // Purchase orders: a tile only while something is on order.
  if (d.orders && (d.orders.toOrder || d.orders.ordered)) {
    const x = d.orders;
    out.push({
      section: "orders",
      name: "Orders",
      big: x.toOrder ? `${x.toOrder} to order` : `${x.ordered} ordered`,
      small: [
        x.late ? `${x.late} late` : x.next ? `next: ${x.next.number} by ${shortDay(x.next.neededBy)}` : "",
        x.toOrder && x.ordered ? `${x.ordered} ordered` : "",
        `${money(x.left)} still to buy`,
      ]
        .filter(Boolean)
        .join(" · "),
      tone: x.late ? "warn" : undefined,
    });
  }
  // The as-built record (10 Nov 2026): the floor being measured and how far it's got.
  if (d.asbuilt) {
    const x = d.asbuilt;
    out.push(
      x.floor
        ? { section: "asbuilt", name: "As-built", big: `${x.floor.replace(/ floor$/i, "")}: ${x.measured} of ${x.total} measured`, small: `plan, measurements and set-out${x.last ? ` · last change ${shortDay(x.last.slice(0, 10))}` : ""}` }
        : { section: "asbuilt", name: "As-built", big: "Every floor's plan", small: "nothing measured yet: the drawings' figures" }
    );
  }
  // Site updates (11 Nov 2026): when the last one went out; the tile opens the form for the next.
  if (d.updates) {
    const x = d.updates.last;
    out.push(
      x
        ? { section: "updates", name: "Site updates", big: `Last update ${shortDay(x.date)}`, small: [x.title, `${x.photos} ${x.photos === 1 ? "photo" : "photos"}`].filter(Boolean).join(" · ") }
        : { section: "updates", name: "Site updates", big: "Post site photos", small: "to the website, Facebook and Instagram" }
    );
  }
  if (d.steel) {
    const x = d.steel;
    const t = (n: number) => `${Math.round(n * 10) / 10} t`;
    const toType = x.unknown ? `${x.unknown} ${x.unknown === 1 ? "buy" : "buys"} with no tons` : "";
    out.push(
      x.installed > 0
        ? {
            section: "steel",
            name: "Steel",
            big: x.owed >= 0 ? `${money(x.owed)} owed` : `${money(-x.owed)} paid ahead`,
            small: [`${t(x.installed)} installed · ${t(Math.max(x.stock, 0))} in stock`, toType].filter(Boolean).join(" · "),
            tone: x.unknown || x.stock < 0 ? "warn" : undefined,
          }
        : { section: "steel", name: "Steel", big: "Log the tons installed", small: [`${t(x.bought)} bought · ${money(x.paid)} paid`, toType].filter(Boolean).join(" · "), tone: "warn" }
    );
  }
  if (d.suppliers) {
    const x = d.suppliers;
    out.push(
      x.owed > 0
        ? {
            section: "suppliers",
            name: "Suppliers",
            big: `${money(x.owed)} owed`,
            small: [`${x.open} ${x.open === 1 ? "bill" : "bills"} to ${x.suppliers} ${x.suppliers === 1 ? "supplier" : "suppliers"}`, x.overdue ? `${x.overdue} overdue` : x.nextDue ? `next due ${shortDay(x.nextDue)}` : ""].filter(Boolean).join(" · "),
            tone: x.overdue ? "warn" : undefined,
          }
        : { section: "suppliers", name: "Suppliers", big: "Nothing owed", small: "add a bill when a supplier gives credit", tone: "ok" }
    );
  }
  if (d.spending) {
    const x = d.spending;
    out.push({
      section: "spending",
      name: "Spending",
      big: `${money(x.month)} this month`,
      small: x.read ? `${money(x.year)} this year · by cost type, floor, supplier` : "QuickBooks not read yet: open it to read",
    });
  }
  if (d.buyers) {
    const x = d.buyers;
    const usd = (n: number) => `US$ ${n.toLocaleString("en-US")}`;
    out.push({
      section: "buyers",
      name: "Buyers",
      big: `${usd(x.paidUSD)} paid`,
      small: [`of ${usd(x.priceUSD)} · ${x.count} ${x.count === 1 ? "buyer" : "buyers"}`, x.last ? `last: ${x.last.name.split(" ")[0]}${x.last.date ? `, ${shortDay(x.last.date)}` : ""}` : ""].filter(Boolean).join(" · "),
    });
  }
  if (d.alerts) out.push({ section: "alerts", name: "Alerts", big: unread ? `${unread} new` : "All caught up", tone: unread ? "warn" : "ok" });
  return out;
}

/** The home page's figures as the page brings them (app/todo/page.tsx): today's date, and the figures on their way. */
export interface FirstHome {
  today: string;
  figures: Promise<DashboardData | null>;
}

/** The figures that came with the page: waits for them ("Loading…" meanwhile), shows them, and hands them over. */
function FromPage({ figures, show, onFigures }: { figures: Promise<DashboardData | null>; show: (d: DashboardData) => ReactNode; onFigures: (d: DashboardData | null) => void }) {
  const d = use(figures);
  useEffect(() => onFigures(d), [d, onFigures]);
  return d ? show(d) : <p className={styles.loading}>Loading…</p>;
}

export function Dashboard({
  me,
  active,
  onGo,
  onRollcall,
  onStoreTab,
  unread,
  firstHome,
  onReady,
}: {
  me: TodoMe;
  active: boolean;
  /** Opened on the home page: its figures come with the page (18 Nov 2026: the app was slow to open on a phone). */
  firstHome?: FirstHome;
  /** The figures are on screen: the app then loads its other parts quietly. */
  onReady?: () => void;
  onGo: (view: View) => void;
  /** The roll call's tiles open it in the app, on their tab. */
  onRollcall: (tab: RollcallTab) => void;
  /** The shopping list's tile opens the store on its list. */
  onStoreTab: (tab: "buy") => void;
  unread: number;
}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [offline, setOffline] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      if (response.status === 401) {
        window.location.reload(); // signed out: the app's own sign-in comes up
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      setData((await response.json()) as DashboardData);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  // The page brought the first figures: no need to ask again the moment it opens (only when coming back to it).
  const pageBrought = useRef(Boolean(firstHome));
  useEffect(() => {
    if (!active) return;
    const first = pageBrought.current ? undefined : setTimeout(() => void refresh(), 0);
    pageBrought.current = false;
    const stop = startPolling(refresh, 30_000, 120_000);
    return () => {
      clearTimeout(first);
      stop();
    };
  }, [active, refresh]);

  // Once the figures are on screen, the app may load its other parts.
  const told = useRef(false);
  useEffect(() => {
    if (!data || told.current) return;
    told.current = true;
    onReady?.();
  }, [data, onReady]);
  const fromPage = useCallback(
    (d: DashboardData | null) => {
      if (d) setData((now) => now ?? d);
      else void refresh(); // the page couldn't bring them: ask now
    },
    [refresh]
  );

  const showTiles = (d: DashboardData) => (
    <div className={home.tiles}>
      {/* Every part opens here at once; the roll call's tiles on their tab. */}
      {tiles(d, d.alerts ? unread : 0).map((t) => (
              <a
                key={t.key ?? t.section}
                href={`${sectionHref(t.section)}${t.tab ? `#${t.tab}` : ""}`}
                className={`${home.tile} ${t.tone === "warn" ? home.warn : t.tone === "ok" ? home.ok : ""}`}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  const rcTab = t.section === "rollcall" ? "today" : t.section === "payday" ? "week" : t.section === "workers" ? "workers" : null;
                  if (rcTab) {
                    e.preventDefault();
                    onRollcall(rcTab);
                    return;
                  }
                  if (!isPageSection(t.section)) return;
                  e.preventDefault();
                  if (t.tab) onStoreTab(t.tab);
                  onGo(t.section);
                }}
              >
                <span className={home.name}>{t.name}</span>
                <span className={home.big}>{t.big}</span>
                {t.small && <span className={home.small}>{t.small}</span>}
              </a>
            ))}
    </div>
  );

  return (
    <>
      <SiteHeader
        eyebrow="The Lexington"
        title={data ? longDay(data.today) : firstHome ? longDay(firstHome.today) : "Today"}
        sub={`Hello, ${me.name.split(" ")[0]}`}
        onMenu={() => setMenuOpen(true)}
      />
      {offline && (
        <div className={styles.banner} role="status">
          No signal: the figures will come when it&rsquo;s back.
        </div>
      )}
      <main className={styles.main}>
        {data ? (
          showTiles(data)
        ) : firstHome ? (
          <Suspense fallback={<p className={styles.loading}>Loading…</p>}>
            <FromPage figures={firstHome.figures} show={showTiles} onFigures={fromPage} />
          </Suspense>
        ) : (
          <p className={styles.loading}>Loading…</p>
        )}
      </main>
      {menuOpen && <SiteMenu me={me} onClose={() => setMenuOpen(false)} onRefresh={() => void refresh()} onLogins={() => setAccessOpen(true)} />}
      {accessOpen && <AccessSheet onClose={() => setAccessOpen(false)} />}
    </>
  );
}
