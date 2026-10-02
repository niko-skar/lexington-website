"use client";

import { useState, type ReactNode } from "react";

import styles from "./Crm.module.css";

export interface CrmTab {
  key: string;
  label: string;
  count?: number;
  /** Grey badge instead of the red "needs you" one. */
  muted?: boolean;
  content: ReactNode;
}

// Every view is on the page already, so switching tabs is instant -- no trip
// to the server.
export function CrmTabs({ tabs, initial }: { tabs: CrmTab[]; initial: string }) {
  const [active, setActive] = useState(initial);
  const [seenInitial, setSeenInitial] = useState(initial);

  // Opening the page at a different tab (e.g. a link to "Lost") wins over
  // whatever tab was showing.
  if (initial !== seenInitial) {
    setSeenInitial(initial);
    setActive(initial);
  }

  function choose(key: string) {
    setActive(key);
    window.history.replaceState(null, "", `/admin/crm?view=${key}`);
  }

  return (
    <>
      <div className={styles.tabs} role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active === tab.key}
            className={`${styles.tab} ${active === tab.key ? styles.tabActive : ""}`}
            onClick={() => choose(tab.key)}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className={`${styles.badge} ${tab.muted ? styles.badgeMuted : ""}`}>{tab.count}</span>
            )}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div key={tab.key} role="tabpanel" hidden={active !== tab.key}>
          {tab.content}
        </div>
      ))}
    </>
  );
}
