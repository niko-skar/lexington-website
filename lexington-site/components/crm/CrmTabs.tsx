"use client";

import { useState, type ReactNode } from "react";

import styles from "./Crm.module.css";
import { CrmSearch, type SearchEntry } from "./CrmSearch";
import { FollowUpProvider } from "./FollowUp";

export interface CrmTab {
  key: string;
  label: string;
  count?: number;
  /** Grey badge instead of the red "needs you" one. */
  muted?: boolean;
  content: ReactNode;
}

// The Prospects screen: a slim top bar (title, find-anybody search, add), the
// tabs, and the view under them. Every view is on the page already, so switching
// tabs is instant -- no trip to the server.
export function CrmTabs({
  tabs,
  initial,
  today,
  search,
  addForm,
}: {
  tabs: CrmTab[];
  initial: string;
  today: string;
  search: SearchEntry[];
  addForm: ReactNode;
}) {
  const [active, setActive] = useState(initial);
  const [seenInitial, setSeenInitial] = useState(initial);
  const [adding, setAdding] = useState(false);

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
      <div className={styles.toolbar}>
        <h1 className={styles.toolbarTitle}>Prospects</h1>
        <CrmSearch entries={search} />
        <button
          type="button"
          className={styles.btnPrimary}
          aria-expanded={adding}
          onClick={() => setAdding((open) => !open)}
        >
          {adding ? "Close" : "+ Add prospect"}
        </button>
      </div>

      {adding && <div className={styles.addPanel}>{addForm}</div>}

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

      <FollowUpProvider today={today}>
        {tabs.map((tab) => (
          <div key={tab.key} role="tabpanel" hidden={active !== tab.key}>
            {tab.content}
          </div>
        ))}
      </FollowUpProvider>
    </>
  );
}
