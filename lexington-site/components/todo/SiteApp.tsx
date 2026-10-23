"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import type { AlertsData } from "@/lib/alerts/shared";
import type { Expense } from "@/lib/expenses/shared";
import { needsReorder, type StoreData, type StoreItem } from "@/lib/store/shared";
import { sectionHref, SECTIONS, type Section, type TodoList, type TodoMe, type TodoTask } from "@/lib/todo/shared";
import { AlertsApp } from "./AlertsApp";
import { startPolling } from "./api";
import { ExpensesApp } from "./ExpensesApp";
import { appClass, SiteNav } from "./SiteChrome";
import { StoreApp } from "./StoreApp";
import { TodoApp } from "./TodoApp";
import styles from "./Todo.module.css";

// The whole site app in one page, so moving between To-do, Store and Expenses is instant (Niko,
// 23 Oct 2026: "its too slow, clicking between things is laggy"). Each part loads once and stays
// loaded; only the part on screen keeps itself fresh. The others are fetched quietly a moment
// after the app opens, so the first tap on them is instant too. The address bar follows along.

export type { StoreData };
export type ExpensesData = { expenses: Expense[]; items: StoreItem[] };
export type SiteData = { todo?: TodoTask[]; store?: StoreData; expenses?: ExpensesData; alerts?: AlertsData };

const sectionFrom = (path: string): Section | null =>
  path.startsWith("/todo/store")
    ? "store"
    : path.startsWith("/todo/expenses")
      ? "expenses"
      : path.startsWith("/todo/alerts")
        ? "alerts"
        : path.startsWith("/todo")
          ? "todo"
          : null;

async function load(section: Section): Promise<SiteData> {
  const get = async (url: string) => {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    return response.json();
  };
  if (section === "todo") return { todo: (await get("/api/todo")).tasks };
  if (section === "store") return { store: await get("/api/store") };
  if (section === "alerts") return { alerts: await get("/api/alerts") };
  const [x, s] = await Promise.all([get("/api/expenses"), get("/api/store")]);
  return { expenses: { expenses: x.expenses, items: s.items } };
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

  if (standalone || closedBefore || closedNow) return null;
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
          <span>Put the app on your home screen so it opens like an app.</span>
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
  startedOffline,
}: {
  me: TodoMe;
  section: Section;
  initial: SiteData;
  initialList?: TodoList;
  /** Opened from a phone alert: the alert to show. */
  openAlert?: string;
  startedOffline: boolean;
}) {
  const [section, setSection] = useState<Section>(first);
  const [opened, setOpened] = useState<Section[]>([first]);
  const [data, setData] = useState<SiteData>(initial);
  const [reorders, setReorders] = useState(() => (initial.store ? initial.store.items.filter(needsReorder).length : 0));
  const [unread, setUnread] = useState(() => initial.alerts?.unread ?? 0);
  const current = useRef(first);
  const scrollAt = useRef<Partial<Record<Section, number>>>({});
  const hasAlerts = me.sections.includes("alerts");

  // The other parts, fetched quietly once the first one is on screen.
  useEffect(() => {
    let live = true;
    const timer = setTimeout(async () => {
      for (const s of SECTIONS) {
        if (!live || s === first || !me.sections.includes(s)) continue;
        try {
          const loaded = await load(s);
          if (!live) return;
          setData((d) => ({ ...loaded, ...d }));
          if (loaded.store) setReorders(loaded.store.items.filter(needsReorder).length);
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
    (next: Section, push = true) => {
      if (!me.sections.includes(next)) return;
      if (next === current.current) {
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      scrollAt.current[current.current] = window.scrollY;
      current.current = next;
      setSection(next);
      setOpened((o) => (o.includes(next) ? o : [...o, next]));
      if (push) window.history.pushState(null, "", sectionHref(next));
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

  const show = (s: Section) => opened.includes(s) && me.sections.includes(s);

  return (
    <div className={appClass(me)}>
      <InstallHint />
      {show("todo") && (
        <div hidden={section !== "todo"}>
          <TodoApp me={me} active={section === "todo"} initialTasks={data.todo ?? null} initialList={initialList} startedOffline={startedOffline && first === "todo"} fresh={first === "todo"} />
        </div>
      )}
      {show("store") && (
        <div hidden={section !== "store"}>
          <StoreApp
            me={me}
            active={section === "store"}
            initial={data.store ?? null}
            startedOffline={startedOffline && first === "store"}
            onReorders={setReorders}
            fresh={first === "store"}
          />
        </div>
      )}
      {show("expenses") && (
        <div hidden={section !== "expenses"}>
          <ExpensesApp me={me} active={section === "expenses"} initial={data.expenses ?? null} startedOffline={startedOffline && first === "expenses"} fresh={first === "expenses"} />
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
          />
        </div>
      )}
      <SiteNav me={me} current={section} onGo={go} badges={{ store: reorders, alerts: unread }} />
    </div>
  );
}
