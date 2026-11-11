"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import type { AlertsData } from "@/lib/alerts/shared";
import type { AnalysisData } from "@/lib/analysis/shared";
import type { BuyersData } from "@/lib/buyers/shared";
import type { CashflowPage } from "@/lib/cashflow/server";
import type { ConcreteData } from "@/lib/concrete/shared";
import type { BankDebit, Expense } from "@/lib/expenses/shared";
import type { SteelData } from "@/lib/expenses/steel";
import type { OrdersPage } from "@/lib/orders/shared";
import type { VisitsData } from "@/lib/siteVisits/shared";
import type { SpendingData } from "@/lib/spending/shared";
import type { OpenBill, SuppliersPage } from "@/lib/suppliers/shared";
import type { BookLists } from "@/lib/quickbooks/books";
import { opensRollcall } from "@/lib/rollcall/shared";
import type { OpenArrival } from "@/lib/store/deliveries";
import type { StoreData, StoreItem } from "@/lib/store/shared";
import { FINANCE_SECTIONS, isFinance, PAGE_SECTIONS, sectionHref, type FinanceSection, type PageSection, type TodoList, type TodoMe, type TodoTask } from "@/lib/todo/shared";
import { AlertsApp } from "./AlertsApp";
import { AnalysisApp } from "./AnalysisApp";
import { send, startPolling } from "./api";
import type { AsBuiltData } from "./AsBuiltPart";
import type { UpdatesData } from "./UpdatesPart";
import { BuyersApp } from "./BuyersApp";
import { CashflowApp } from "./CashflowApp";
import { ConcreteApp } from "./ConcreteApp";
import { Dashboard } from "./Dashboard";
import type { ExpensePrefill } from "./ExpenseForm";
import { ExpensesApp } from "./ExpensesApp";
import { OrdersApp } from "./OrdersApp";
import { usePhoneAlerts } from "./PhoneAlerts";
import { onUploads, resumeUploads, waitingUploads } from "./photoQueue";
import { RollcallPart, rollcallTabOf, type RollcallTab } from "./RollcallPart";
import { appClass, FinanceTabs, SiteNav, type NavItem, type View } from "./SiteChrome";
import { SpendingApp } from "./SpendingApp";
import { SteelApp } from "./SteelApp";
import { StoreApp } from "./StoreApp";
import { SuppliersApp, type BillPayment, type BillPrefill } from "./SuppliersApp";
import { TodoApp } from "./TodoApp";
import { VisitsApp } from "./VisitsApp";
import styles from "./Todo.module.css";
import { useSheetGestures } from "./useSheetGestures";

// The as-built record's screen is big (the plan, its panels): fetched only when the office opens that part. Site updates
// (the website's progress reporter) too: the office only, now and then.
const AsBuiltPart = dynamic(() => import("./AsBuiltPart").then((m) => m.AsBuiltPart), { loading: () => null });
const UpdatesPart = dynamic(() => import("./UpdatesPart").then((m) => m.UpdatesPart), { loading: () => null });
/** Parts read only when they're opened (not quietly after the app opens): the as-built record is big; Site updates is rare. */
const ON_OPENING: readonly PageSection[] = ["asbuilt", "updates"];

// The whole site app in one page, so moving between To-do, Store and Expenses is instant (Niko,
// 23 Oct 2026: "its too slow, clicking between things is laggy"). Each part loads once and stays
// loaded; only the part on screen keeps itself fresh. The others are fetched quietly a moment
// after the app opens, so the first tap on them is instant too. The address bar follows along.

export type { StoreData };
export type ExpensesData = { expenses: Expense[]; items: StoreItem[]; arrivals?: OpenArrival[]; pending?: BankDebit[]; books?: BookLists; bills?: OpenBill[]; vendors?: string[] };
export type SiteData = {
  todo?: TodoTask[];
  store?: StoreData;
  expenses?: ExpensesData;
  alerts?: AlertsData;
  concrete?: ConcreteData;
  buyers?: BuyersData;
  steel?: SteelData;
  suppliers?: SuppliersPage;
  spending?: SpendingData;
  orders?: OrdersPage;
  cashflow?: CashflowPage;
  analysis?: AnalysisData;
  asbuilt?: AsBuiltData;
  visits?: VisitsData;
  updates?: UpdatesData;
};

// Since 30 Oct 2026 the app opens on its home page (/todo) and the to-do list is /todo/jobs.
const sectionFrom = (path: string): View | null =>
  path.startsWith("/todo/store")
    ? "store"
    : path.startsWith("/todo/expenses")
      ? "expenses"
      : path.startsWith("/todo/alerts")
        ? "alerts"
        : path.startsWith("/todo/concrete")
          ? "concrete"
          : path.startsWith("/todo/buyers")
            ? "buyers"
          : path.startsWith("/todo/steel")
            ? "steel"
          : path.startsWith("/todo/rollcall")
            ? "rollcall"
          : path.startsWith("/todo/suppliers")
            ? "suppliers"
          : path.startsWith("/todo/spending")
            ? "spending"
          : path.startsWith("/todo/orders")
            ? "orders"
          : path.startsWith("/todo/cashflow")
            ? "cashflow"
          : path.startsWith("/todo/analysis")
            ? "analysis"
          : path.startsWith("/todo/asbuilt")
            ? "asbuilt"
          : path.startsWith("/todo/visits")
            ? "visits"
          : path.startsWith("/todo/updates")
            ? "updates"
          : path.startsWith("/todo/jobs")
          ? "todo"
          : path === "/todo" || path === "/todo/"
            ? "home"
            : null;
const hrefOf = (view: View) => (view === "home" ? "/todo" : view === "rollcall" ? "/todo/rollcall" : sectionHref(view));

async function load(section: PageSection): Promise<SiteData> {
  const get = async (url: string) => {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    return response.json();
  };
  if (section === "todo") return { todo: (await get("/api/todo")).tasks };
  if (section === "store") return { store: await get("/api/store") };
  if (section === "alerts") return { alerts: await get("/api/alerts") };
  if (section === "concrete") return { concrete: await get("/api/concrete") };
  if (section === "buyers") return { buyers: await get("/api/buyers") };
  if (section === "steel") return { steel: await get("/api/steel") };
  if (section === "suppliers") return { suppliers: await get("/api/suppliers") };
  if (section === "spending") return { spending: await get("/api/spending") };
  if (section === "orders") return { orders: await get("/api/orders") };
  if (section === "cashflow") return { cashflow: await get("/api/cashflow") };
  if (section === "analysis") return { analysis: await get("/api/analysis") };
  if (section === "asbuilt") return { asbuilt: await get("/api/asbuilt") };
  if (section === "visits") return { visits: await get("/api/site-visits") };
  if (section === "updates") return { updates: await get("/api/updates") };
  const [x, s] = await Promise.all([get("/api/expenses"), get("/api/store")]);
  return { expenses: { expenses: x.expenses, items: s.items, arrivals: s.arrivals, pending: x.pending, books: x.books, bills: x.bills, vendors: x.vendors } };
}

/* ---------- put it on the home screen ---------- */

type InstallPrompt = Event & { prompt: () => Promise<void> };
const never = () => () => {};
const useStandalone = () =>
  useSyncExternalStore(
    never,
    () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
    () => true
  );
const useIphone = () => useSyncExternalStore(never, () => /iphone|ipad|ipod/i.test(navigator.userAgent), () => false);
// A laptop or desktop (a mouse, not a phone): the app installs as a window of its own there, not on a home screen.
const useComputer = () => useSyncExternalStore(never, () => window.matchMedia("(pointer: fine)").matches && !/android|iphone|ipad|ipod/i.test(navigator.userAgent), () => false);
const useHintClosedBefore = () =>
  useSyncExternalStore(
    never,
    () => {
      try {
        return localStorage.getItem("todo-hint-closed") === "1";
      } catch {
        return false;
      }
    },
    () => true
  );

function InstallHint() {
  const standalone = useStandalone();
  const isIphone = useIphone();
  const computer = useComputer();
  const closedBefore = useHintClosedBefore();
  const [closedNow, setClosedNow] = useState(false);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);

  // The helper that lets Android install it, and Android's own install offer.
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    navigator.serviceWorker?.register("/todo-sw.js", { scope: "/todo" }).catch(() => {});
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  // A computer's browser that can't install it (no install offer): no tip at all.
  if (standalone || closedBefore || closedNow || (computer && !prompt)) return null;
  const close = () => {
    setClosedNow(true);
    try {
      localStorage.setItem("todo-hint-closed", "1");
    } catch {
      /* private mode: the tip just comes back next time */
    }
  };
  return (
    <div className={styles.hint}>
      {prompt ? (
        <>
          <span>{computer ? "Install the app on this computer: it opens in its own window, with its own icon." : "Put the app on your home screen so it opens like an app."}</span>
          <button
            type="button"
            className={styles.hintButton}
            onClick={async () => {
              await prompt.prompt().catch(() => {});
              setPrompt(null);
            }}
          >
            Install the app
          </button>
        </>
      ) : isIphone ? (
        <span>
          Put it on your home screen: tap <b>Share</b> <span aria-hidden="true">⬆︎</span>, then <b>Add to Home Screen</b>. It then opens like an app.
        </span>
      ) : (
        <span>
          Put it on your home screen: in Chrome tap <b>⋮</b>, then <b>Add to Home screen</b> (or <b>Install app</b>).
        </span>
      )}
      <button type="button" className={styles.hintClose} onClick={close} aria-label="Close the tip">
        ✕
      </button>
    </div>
  );
}

/* ---------- the app ---------- */

export function SiteApp({
  me,
  section: first,
  initial,
  initialList,
  openAlert,
  openJob,
  openEntry,
  openTruck,
  openDebit,
  seenAlert,
  startedOffline,
}: {
  me: TodoMe;
  section: View;
  initial: SiteData;
  initialList?: TodoList;
  /** Opened from a phone alert: the alert to show. */
  openAlert?: string;
  /** Opened from a phone alert about a job: the job to show. */
  openJob?: string;
  /** Opened from a bank text's phone alert: the money in to show in the form. */
  openEntry?: string;
  /** Opened from a phone alert about a concrete truck: the truck to show. */
  openTruck?: string;
  /** Opened from a bank debit's phone alert: the debit to complete. */
  openDebit?: string;
  /** ...and (the office) the alert it came with, which has now been seen. */
  seenAlert?: string;
  startedOffline: boolean;
}) {
  const [section, setSection] = useState<View>(first);
  const [opened, setOpened] = useState<View[]>([first]);
  const [data, setData] = useState<SiteData>(initial);
  // The store's tab asked for (the home page's To buy tile, the back button to #buy; it reads #buy itself on opening).
  const [storeAsk, setStoreAsk] = useState<{ tab: "buy"; at: number } | null>(null);
  const [unread, setUnread] = useState(() => initial.alerts?.unread ?? 0);
  const current = useRef(first);
  const scrollAt = useRef<Partial<Record<View, number>>>({});
  const hasAlerts = me.sections.includes("alerts");
  // "Pay" on a supplier's bill: the expense form, filled in for it.
  const [payAsk, setPayAsk] = useState<{ payment: BillPayment; at: number } | null>(null);
  // Finance's parts asked from each other (5 Nov 2026): "Pay it now" on an order (the expense form), "Make it a bill"
  // (the supplier's bill form) or a bill on the cash flow (the supplier's page), an order on the cash flow.
  const [orderPayAsk, setOrderPayAsk] = useState<{ prefill: ExpensePrefill; at: number } | null>(null);
  const [supplierAsk, setSupplierAsk] = useState<{ vendorId: string; bill?: BillPrefill; at: number } | null>(null);
  const [orderAsk, setOrderAsk] = useState<{ orderId: string; at: number } | null>(null);
  // The Finance item on the bar opens the part of it used last.
  const lastFinance = useRef<FinanceSection>(isFinance(first) ? first : (FINANCE_SECTIONS.find((s) => me.sections.includes(s)) ?? "expenses"));
  // The roll call's tab asked for (the address's #week, the home page's Payday tile).
  const [rcAsk, setRcAsk] = useState<{ tab: RollcallTab; at: number } | null>(null);
  useEffect(() => {
    const tab = first === "rollcall" ? rollcallTabOf(window.location.hash) : null;
    if (!tab) return;
    const timer = setTimeout(() => setRcAsk({ tab, at: Date.now() }), 0);
    return () => clearTimeout(timer);
  }, [first]);
  // The address follows the roll call's tab while it's on screen.
  const onRcTab = useCallback((tab: RollcallTab) => {
    if (current.current === "rollcall") window.history.replaceState(null, "", `/todo/rollcall#${tab}`);
  }, []);
  // This phone's alerts, for whoever is signed in (the office's, or the foreman's new jobs).
  const phone = usePhoneAlerts(me);

  // Opened from a phone alert about a job: that alert has been seen (the badge goes down).
  useEffect(() => {
    if (!seenAlert || !hasAlerts) return;
    send<{ unread: number }>("/api/alerts", "POST", { read: [seenAlert] }).then(
      (result) => setUnread(result.unread),
      () => {}
    );
  }, [seenAlert, hasAlerts]);

  // The other parts, fetched quietly once the first one is on screen.
  useEffect(() => {
    let live = true;
    const timer = setTimeout(async () => {
      // The roll call's page loads in its frame meanwhile, so the first tap on it is instant too.
      if (opensRollcall(me.sections)) setOpened((o) => (o.includes("rollcall") ? o : [...o, "rollcall"]));
      for (const s of PAGE_SECTIONS) {
        if (!live || s === first || !me.sections.includes(s) || ON_OPENING.includes(s)) continue;
        try {
          const loaded = await load(s);
          if (!live) return;
          setData((d) => ({ ...loaded, ...d }));
          if (loaded.alerts) setUnread(loaded.alerts.unread);
        } catch {
          /* it loads when opened instead */
        }
      }
    }, 1200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // Once per app start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = useCallback(
    (item: NavItem, push = true) => {
      const next: View = item === "finance" ? lastFinance.current : item;
      if (next !== "home" && !(next === "rollcall" ? opensRollcall(me.sections) : me.sections.includes(next))) return;
      if (isFinance(next)) lastFinance.current = next;
      if (next === current.current) {
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      scrollAt.current[current.current] = window.scrollY;
      current.current = next;
      setSection(next);
      setOpened((o) => (o.includes(next) ? o : [...o, next]));
      if (push) window.history.pushState(null, "", hrefOf(next));
    },
    [me.sections]
  );

  // Each part comes back where it was left.
  useLayoutEffect(() => {
    window.scrollTo(0, scrollAt.current[section] ?? 0);
  }, [section]);

  // The phone's back button moves between parts like pages.
  useEffect(() => {
    const onPop = () => {
      const s = sectionFrom(window.location.pathname);
      if (s) go(s, false);
      const tab = s === "rollcall" ? rollcallTabOf(window.location.hash) : null;
      if (tab) setRcAsk({ tab, at: Date.now() });
      if (s === "store" && window.location.hash === "#buy") setStoreAsk({ tab: "buy", at: Date.now() });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [go]);

  // The office: the Alerts badge stays fresh while another part is on screen (the tab itself keeps its own count).
  useEffect(() => {
    if (!hasAlerts || section === "alerts") return;
    return startPolling(
      async () => {
        try {
          const response = await fetch("/api/alerts?count=1", { cache: "no-store" });
          if (response.ok) setUnread(((await response.json()) as { unread: number }).unread);
        } catch {
          /* no signal: the badge waits */
        }
      },
      30_000,
      120_000
    );
  }, [hasAlerts, section]);

  // The same count on the app's home-screen icon, where the phone allows it.
  useEffect(() => {
    if (!hasAlerts) return;
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    (unread > 0 ? nav.setAppBadge?.(unread) : nav.clearAppBadge?.())?.catch(() => {});
  }, [hasAlerts, unread]);

  // Sheets close on a tap outside, a pull down, or Esc on a laptop (useSheetGestures.ts).
  useSheetGestures();

  // Photos saved before they landed: the ones left from last time go on now, and the app says while any are going.
  useEffect(() => void resumeUploads(), []);
  const photosGoing = useSyncExternalStore(onUploads, waitingUploads, () => 0);

  const show = (s: View) => opened.includes(s) && (s === "home" || (s === "rollcall" ? opensRollcall(me.sections) : me.sections.includes(s)));
  // Finance's tabs, in the header of each of its parts.
  const tabs = (s: FinanceSection) => <FinanceTabs me={me} current={s} onGo={go} />;

  return (
    <div className={appClass(me)} data-app="site">
      <InstallHint />
      {photosGoing > 0 && (
        <p className={styles.photosGoing} role="status">
          {photosGoing === 1 ? "1 photo" : `${photosGoing} photos`} still uploading: keep the app open until it&rsquo;s done
        </p>
      )}
      {show("home") && (
        <div hidden={section !== "home"}>
          <Dashboard
            me={me}
            active={section === "home"}
            onGo={go}
            onRollcall={(tab) => {
              setRcAsk({ tab, at: Date.now() });
              go("rollcall");
            }}
            onStoreTab={(tab) => setStoreAsk({ tab, at: Date.now() })}
            unread={unread}
          />
        </div>
      )}
      {show("todo") && (
        <div hidden={section !== "todo"}>
          <TodoApp
            me={me}
            active={section === "todo"}
            initialTasks={data.todo ?? null}
            initialList={initialList}
            openJob={openJob}
            phone={phone}
            startedOffline={startedOffline && first === "todo"}
            fresh={first === "todo"}
          />
        </div>
      )}
      {show("visits") && (
        <div hidden={section !== "visits"}>
          <VisitsApp
            me={me}
            active={section === "visits"}
            initial={data.visits ?? null}
            startedOffline={startedOffline && first === "visits"}
            fresh={first === "visits"}
          />
        </div>
      )}
      {show("store") && (
        <div hidden={section !== "store"}>
          <StoreApp
            me={me}
            active={section === "store"}
            initial={data.store ?? null}
            startedOffline={startedOffline && first === "store"}
            ask={storeAsk}
            fresh={first === "store"}
          />
        </div>
      )}
      {show("expenses") && (
        <div hidden={section !== "expenses"}>
          <ExpensesApp
            me={me}
            active={section === "expenses"}
            initial={data.expenses ?? null}
            openEntry={openEntry}
            openDebit={openDebit}
            onSteel={() => go("steel")}
            payBill={payAsk}
            payOrder={orderPayAsk}
            tabs={tabs("expenses")}
            startedOffline={startedOffline && first === "expenses"}
            fresh={first === "expenses"}
          />
        </div>
      )}
      {show("orders") && (
        <div hidden={section !== "orders"}>
          <OrdersApp
            me={me}
            active={section === "orders"}
            initial={data.orders ?? null}
            startedOffline={startedOffline && first === "orders"}
            fresh={first === "orders"}
            tabs={tabs("orders")}
            ask={orderAsk}
            onBill={(bill) => {
              setSupplierAsk({ vendorId: bill.vendorId, bill, at: Date.now() });
              go("suppliers");
            }}
            onPay={(prefill) => {
              setOrderPayAsk({ prefill, at: Date.now() });
              go("expenses");
            }}
          />
        </div>
      )}
      {show("cashflow") && (
        <div hidden={section !== "cashflow"}>
          <CashflowApp
            me={me}
            active={section === "cashflow"}
            initial={data.cashflow ?? null}
            startedOffline={startedOffline && first === "cashflow"}
            fresh={first === "cashflow"}
            tabs={tabs("cashflow")}
            onBill={(vendorId) => {
              setSupplierAsk({ vendorId, at: Date.now() });
              go("suppliers");
            }}
            onOrder={(orderId) => {
              setOrderAsk({ orderId, at: Date.now() });
              go("orders");
            }}
          />
        </div>
      )}
      {show("alerts") && (
        <div hidden={section !== "alerts"}>
          <AlertsApp
            me={me}
            active={section === "alerts"}
            initial={data.alerts ?? null}
            startedOffline={startedOffline && first === "alerts"}
            fresh={first === "alerts"}
            openAlert={openAlert}
            onUnread={setUnread}
            phone={phone}
          />
        </div>
      )}
      {show("concrete") && (
        <div hidden={section !== "concrete"}>
          <ConcreteApp
            me={me}
            active={section === "concrete"}
            initial={data.concrete ?? null}
            openTruck={openTruck}
            startedOffline={startedOffline && first === "concrete"}
            fresh={first === "concrete"}
            onOrder={
              me.sections.includes("orders")
                ? (orderId) => {
                    setOrderAsk({ orderId, at: Date.now() });
                    go("orders");
                  }
                : undefined
            }
          />
        </div>
      )}
      {show("buyers") && (
        <div hidden={section !== "buyers"}>
          <BuyersApp
            me={me}
            active={section === "buyers"}
            initial={data.buyers ?? null}
            startedOffline={startedOffline && first === "buyers"}
            fresh={first === "buyers"}
            tabs={tabs("buyers")}
          />
        </div>
      )}
      {show("asbuilt") && (
        <div hidden={section !== "asbuilt"}>
          <AsBuiltPart me={me} active={section === "asbuilt"} initial={data.asbuilt ?? null} startedOffline={startedOffline && first === "asbuilt"} />
        </div>
      )}
      {show("updates") && (
        <div hidden={section !== "updates"}>
          <UpdatesPart me={me} active={section === "updates"} initial={data.updates ?? null} startedOffline={startedOffline && first === "updates"} />
        </div>
      )}
      {show("steel") && (
        <div hidden={section !== "steel"}>
          <SteelApp me={me} active={section === "steel"} initial={data.steel ?? null} startedOffline={startedOffline && first === "steel"} fresh={first === "steel"} />
        </div>
      )}
      {show("spending") && (
        <div hidden={section !== "spending"}>
          <SpendingApp
            me={me}
            active={section === "spending"}
            initial={data.spending ?? null}
            startedOffline={startedOffline && first === "spending"}
            fresh={first === "spending"}
            tabs={tabs("spending")}
          />
        </div>
      )}
      {show("analysis") && (
        <div hidden={section !== "analysis"}>
          <AnalysisApp
            me={me}
            active={section === "analysis"}
            initial={data.analysis ?? null}
            startedOffline={startedOffline && first === "analysis"}
            fresh={first === "analysis"}
            tabs={tabs("analysis")}
          />
        </div>
      )}
      {show("suppliers") && (
        <div hidden={section !== "suppliers"}>
          <SuppliersApp
            me={me}
            active={section === "suppliers"}
            initial={data.suppliers ?? null}
            startedOffline={startedOffline && first === "suppliers"}
            fresh={first === "suppliers"}
            onPay={(payment) => {
              setPayAsk({ payment, at: Date.now() });
              go("expenses");
            }}
            ask={supplierAsk}
            tabs={tabs("suppliers")}
          />
        </div>
      )}
      {show("rollcall") && (
        <div hidden={section !== "rollcall"}>
          <RollcallPart me={me} active={section === "rollcall"} ask={rcAsk} onTab={onRcTab} />
        </div>
      )}
      {/* Only the alerts carry a number on the bar (6 Nov 2026: none on Store; its shopping list says how many itself). */}
      <SiteNav me={me} current={section} onGo={go} badges={{ alerts: unread }} />
    </div>
  );
}
