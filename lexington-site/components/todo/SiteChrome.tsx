"use client";

import Link from "next/link";

import { todoSignOutAction } from "@/lib/actions/todo";
import { opensRollcall } from "@/lib/rollcall/shared";
import { PAGE_SECTIONS, sectionHref, sectionName, type PageSection, type TodoMe } from "@/lib/todo/shared";
import styles from "./Todo.module.css";

// What every part of the site app shares: its header, the bar at the bottom (Home, then the parts this
// login opens: To-do · Store · Expenses · Alerts · Concrete · Roll call) and the ☰ menu.

/** Where the bar can go: the home page, a part drawn in this page, or the roll call (its own page). */
export type View = PageSection | "home";
type NavItem = View | "rollcall";

const ICONS: Record<NavItem, React.ReactNode> = {
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
  rollcall: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 4h8v3H8z" />
      <path d="M8 5.5H5.5V21h13V5.5H16" />
      <path d="M8.5 12l1.5 1.5 3-3M8.5 17h7" />
    </svg>
  ),
};

// What a badge on the bar counts, for a screen reader.
const BADGE_WORDS: Partial<Record<NavItem, string>> = { store: "to reorder", alerts: "new" };

/** Used now and then (Concrete, on pour days): on the bar when there's room, else from the home page's tile. */
const NOW_AND_THEN: readonly NavItem[] = ["concrete"];
const navItems = (me: TodoMe): NavItem[] => {
  const parts: NavItem[] = [...PAGE_SECTIONS.filter((s) => me.sections.includes(s)), ...(opensRollcall(me.sections) ? (["rollcall"] as const) : [])];
  // A login that opens one part only (a storekeeper) has no home page to go back to, so no bar at all.
  if (parts.length < 2) return parts;
  const all: NavItem[] = ["home", ...parts];
  return all.length > 6 ? all.filter((item) => !NOW_AND_THEN.includes(item)) : all;
};
const navName = (item: NavItem) => (item === "home" ? "Home" : item === "rollcall" ? "Roll call" : sectionName(item));
const navHref = (item: NavItem) => (item === "home" ? "/todo" : item === "rollcall" ? "/todo/rollcall" : sectionHref(item));

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
  onGo: (view: View) => void;
  badges?: Partial<Record<NavItem, number>>;
}) {
  const items = navItems(me);
  if (items.length < 2) return null;
  return (
    <nav className={`${styles.nav} ${items.length > 5 ? styles.navMany : ""}`} aria-label="Parts of the app">
      {items.map((item) => {
        const badge = badges?.[item] ?? 0;
        return (
          <a
            key={item}
            href={navHref(item)}
            className={item === current ? styles.navOn : styles.navItem}
            aria-current={item === current ? "page" : undefined}
            onClick={(e) => {
              if (item === "rollcall" || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
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
