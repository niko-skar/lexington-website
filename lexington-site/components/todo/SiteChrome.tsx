"use client";

import Link from "next/link";
import { useLayoutEffect, useRef } from "react";

import { todoSignOutAction } from "@/lib/actions/todo";
import { opensRollcall } from "@/lib/rollcall/shared";
import { FINANCE_SECTIONS, isFinance, PAGE_SECTIONS, sectionHref, sectionName, type FinanceSection, type PageSection, type TodoMe } from "@/lib/todo/shared";
import styles from "./Todo.module.css";

// What every part of the site app shares: its header, the bar at the bottom (Home, then the parts this
// login opens: To-do · Store · Finance · Concrete · Steel · Roll call, Alerts last; on a laptop a rail
// down the left with every part, Alerts at its bottom), Finance's tabs and the ☰ menu.

/** Where the bar can go: the home page, a part drawn in this page, or the roll call (its page in the app's frame). */
export type View = PageSection | "home" | "rollcall";
/** Finance is one place on the bar for its parts (5 Nov 2026): it opens the one used last. */
export type NavItem = View | "finance";

const ICONS: Record<NavItem, React.ReactNode> = {
  finance: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7.5h14.5a1.5 1.5 0 0 1 1.5 1.5v9.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5V6A1.5 1.5 0 0 1 5.5 4.5H16v3" />
      <path d="M20 12h-3.5a1.75 1.75 0 0 0 0 3.5H20" />
    </svg>
  ),
  home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 11L12 4l8.5 7" />
      <path d="M5.5 9.5V20h13V9.5M10 20v-5.5h4V20" />
    </svg>
  ),
  todo: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7l2 2 3.5-3.5M4 15l2 2 3.5-3.5M13 8h7M13 16h7" />
    </svg>
  ),
  store: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 8.5L12 4l8.5 4.5v9L12 22l-8.5-4.5z" />
      <path d="M3.5 8.5L12 13l8.5-4.5M12 13v9" />
    </svg>
  ),
  expenses: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </svg>
  ),
  alerts: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </svg>
  ),
  concrete: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 17v-6.5H7l2 3V17M9 17h12.5" />
      <path d="M10.5 13.5l8.5-5.5 2 3.5-8.5 4.5z" />
      <circle cx="6" cy="18.5" r="1.7" />
      <circle cx="17" cy="18.5" r="1.7" />
    </svg>
  ),
  buyers: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20c.6-3.6 2.8-5.6 5.5-5.6s4.9 2 5.5 5.6" />
      <path d="M15.5 4.8a3.2 3.2 0 0 1 0 6.4M17.5 14.6c1.6.7 2.6 2.5 3 5.4" />
    </svg>
  ),
  steel: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 16.5L16.5 3.5M7.5 20.5L20.5 7.5" />
      <path d="M5 13l6 6M9 9l6 6M13 5l6 6" />
    </svg>
  ),
  // A calendar page: the site visits booked.
  visits: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 6.5h16V20H4z" />
      <path d="M4 10.5h16M8.5 4v4M15.5 4v4" />
      <path d="M9 15.5l2 2 4-4" />
    </svg>
  ),
  // A plan with a dimension line: the as-built record.
  asbuilt: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 4h10v6h6v10H4z" />
      <path d="M7 15.5h10M7 13.5v4M17 13.5v4" />
    </svg>
  ),
  spending: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20h16" />
      <path d="M7 16v-5M12 16V6M17 16v-8" />
    </svg>
  ),
  suppliers: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 10.5L12 5l9 5.5" />
      <path d="M5 9.5V19h14V9.5M9 19v-5h6v5" />
    </svg>
  ),
  // Orders and the cash flow are Finance's tabs, never on the bar themselves; their marks for completeness.
  orders: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3h12v18H6z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </svg>
  ),
  cashflow: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 17l5-5 4 3 8-8" />
      <path d="M15 7h5v5" />
    </svg>
  ),
  analysis: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L20.5 20.5M8 12.5v-2M10.5 12.5v-4M13 12.5v-3" />
    </svg>
  ),
  rollcall: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 4h8v3H8z" />
      <path d="M8 5.5H5.5V21h13V5.5H16" />
      <path d="M8.5 12l1.5 1.5 3-3M8.5 17h7" />
    </svg>
  ),
};

// What a badge on the bar counts, for a screen reader.
const BADGE_WORDS: Partial<Record<NavItem, string>> = { alerts: "new" };

/**
 * Used now and then (Concrete on pour days, Buyers on a payment, Steel as it goes in, the as-built record when
 * measuring or setting out): on a phone's bar when there's room, else from the home page's tile. A laptop's rail has
 * room for every part (2 Nov 2026).
 */
const NOW_AND_THEN: readonly NavItem[] = ["concrete", "steel", "asbuilt"];
type NavEntry = { item: NavItem; laptopOnly: boolean };
const navItems = (me: TodoMe): NavEntry[] => {
  // Alerts last: the end of a phone's bar, the very bottom of a laptop's rail (Niko, 2 Nov 2026). The money parts
  // are one item, Finance, where Expenses was (5 Nov 2026).
  const parts: NavItem[] = [];
  for (const s of PAGE_SECTIONS) {
    if (s === "alerts" || !me.sections.includes(s)) continue;
    if (isFinance(s)) {
      if (!parts.includes("finance")) parts.push("finance");
    } else parts.push(s);
  }
  if (opensRollcall(me.sections)) parts.push("rollcall");
  if (me.sections.includes("alerts")) parts.push("alerts");
  // A login that opens one part only (a storekeeper) has no home page to go back to, so no bar at all.
  if (parts.length < 2) return parts.map((item) => ({ item, laptopOnly: false }));
  const all: NavItem[] = ["home", ...parts];
  const crowded = all.length > 6;
  return all.map((item) => ({ item, laptopOnly: crowded && NOW_AND_THEN.includes(item) }));
};
const firstFinance = (me: TodoMe): FinanceSection => FINANCE_SECTIONS.find((s) => me.sections.includes(s)) ?? "expenses";
const navName = (item: NavItem) => (item === "home" ? "Home" : item === "rollcall" ? "Roll call" : item === "finance" ? "Finance" : sectionName(item));
const navHref = (item: NavItem, me: TodoMe) =>
  item === "home" ? "/todo" : item === "rollcall" ? "/todo/rollcall" : item === "finance" ? sectionHref(firstFinance(me)) : sectionHref(item);

/** Finance's tabs, under its header: one row that slides sideways on a phone, the tab on screen kept in view. */
export function FinanceTabs({ me, current, onGo }: { me: TodoMe; current: FinanceSection; onGo: (view: View) => void }) {
  const row = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const nav = row.current;
    const on = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (nav && on) nav.scrollLeft = Math.max(0, on.offsetLeft - (nav.clientWidth - on.clientWidth) / 2);
  }, [current]);
  return (
    <nav ref={row} className={styles.finTabs} aria-label="Finance">
      {FINANCE_SECTIONS.filter((s) => me.sections.includes(s)).map((s) => (
        <a
          key={s}
          href={sectionHref(s)}
          className={s === current ? styles.finTabOn : styles.finTab}
          aria-current={s === current ? "page" : undefined}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            onGo(s);
          }}
        >
          {sectionName(s)}
        </a>
      ))}
    </nav>
  );
}

/** The class for the app's outer box: room at the bottom for the bar when there is one. */
export const appClass = (me: TodoMe) => (navItems(me).length > 1 ? `${styles.app} ${styles.withNav}` : styles.app);

/** Each part's header: "Building works", the part's name, a line of counts, the ☰ button, then its tabs. */
export function SiteHeader({
  eyebrow = "Building works",
  title,
  sub,
  onMenu,
  children,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  sub?: React.ReactNode;
  onMenu: () => void;
  children?: React.ReactNode;
}) {
  return (
    <header className={styles.top}>
      <div className={styles.topRow}>
        <div className={styles.topText}>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1 className={styles.title}>{title}</h1>
          {sub ? <p className={styles.counts}>{sub}</p> : null}
        </div>
        <button type="button" className={styles.menuButton} onClick={onMenu} aria-label="Menu">
          <span aria-hidden="true">☰</span>
        </button>
      </div>
      {children}
    </header>
  );
}

/**
 * The bar at the bottom. Switching parts of this page happens on the phone at once (they stay loaded); the
 * roll call is its own page, so its item is a plain link. The links carry the real address for a long-press.
 */
export function SiteNav({
  me,
  current,
  onGo,
  badges,
}: {
  me: TodoMe;
  current: View;
  onGo: (item: NavItem) => void;
  badges?: Partial<Record<NavItem, number>>;
}) {
  const items = navItems(me);
  if (items.length < 2) return null;
  const onPhone = items.filter((x) => !x.laptopOnly).length;
  const on = (item: NavItem) => item === current || (item === "finance" && isFinance(current));
  return (
    <nav className={`${styles.nav} ${onPhone > 5 ? styles.navMany : ""}`} aria-label="Parts of the app">
      <p className={styles.navBrand}>
        The Lexington<small>Site app</small>
      </p>
      {items.map(({ item, laptopOnly }) => {
        const badge = badges?.[item] ?? 0;
        return (
          <a
            key={item}
            href={navHref(item, me)}
            className={`${on(item) ? styles.navOn : styles.navItem}${laptopOnly ? ` ${styles.navExtra}` : ""}${item === "alerts" ? ` ${styles.navLast}` : ""}`}
            aria-current={on(item) ? "page" : undefined}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              onGo(item);
            }}
          >
            {ICONS[item]}
            <span>{navName(item)}</span>
            {badge > 0 && (
              <span className={styles.navBadge} aria-label={`${badge} ${BADGE_WORDS[item] ?? ""}`.trim()}>
                {badge}
              </span>
            )}
          </a>
        );
      })}
    </nav>
  );
}

/** The ☰ menu. Each part puts its own buttons on top (the to-do its two lists). */
export function SiteMenu({
  me,
  onClose,
  onRefresh,
  onLogins,
  children,
}: {
  me: TodoMe;
  onClose: () => void;
  onRefresh: () => void;
  onLogins: () => void;
  children?: React.ReactNode;
}) {
  const isAdmin = me.kind === "admin";
  return (
    <div className={styles.sheetBackdrop} onClick={onClose}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Menu">
        <p className={styles.sheetNote}>
          Signed in as <b>{me.name}</b>
          {isAdmin ? " (office)" : ""}
        </p>
        {children}
        <div className={styles.menuList}>
          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onLogins();
              }}
            >
              Site logins
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              onClose();
              onRefresh();
            }}
          >
            Refresh now
          </button>
          {isAdmin && <Link href="/admin/crm">Back to the admin pages</Link>}
          <form action={todoSignOutAction}>
            <button type="submit">Sign out</button>
          </form>
        </div>
        <button type="button" className={styles.sheetCancel} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
