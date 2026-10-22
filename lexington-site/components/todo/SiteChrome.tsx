"use client";

import Link from "next/link";

import { todoSignOutAction } from "@/lib/actions/todo";
import { sectionHref, sectionName, type Section, type TodoMe } from "@/lib/todo/shared";
import styles from "./Todo.module.css";

// What every part of the site app shares: the bar at the bottom (To-do · Store · Expenses, only
// the parts this login opens) and the ☰ menu.

const ICONS: Record<Section, React.ReactNode> = {
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
};

/** The class for the page's outer box: room at the bottom for the bar when there is one. */
export const appClass = (me: TodoMe) => (me.sections.length > 1 ? `${styles.app} ${styles.withNav}` : styles.app);

export function SiteNav({ me, current }: { me: TodoMe; current: Section }) {
  if (me.sections.length < 2) return null;
  return (
    <nav className={styles.nav} aria-label="Parts of the app">
      {me.sections.map((section) => (
        <Link
          key={section}
          href={sectionHref(section)}
          className={section === current ? styles.navOn : styles.navItem}
          aria-current={section === current ? "page" : undefined}
        >
          {ICONS[section]}
          <span>{sectionName(section)}</span>
        </Link>
      ))}
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
