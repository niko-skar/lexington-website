"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { appListHref, CrmHostProvider, type CrmHostApi, type CrmView } from "@/components/crm/CrmHost";
import { CrmLists } from "@/components/crm/CrmLists";
import { ProspectView } from "@/components/crm/ProspectView";
import { ToastProvider } from "@/components/crm/Toasts";
import { buildCrmData, ownerOf } from "@/components/crm/data";
import type { CrmListData, ProspectData } from "@/lib/crmPage";
import { prospectHref, prospectOfPath, type TodoMe } from "@/lib/todo/shared";
import { AccessSheet } from "./AccessSheet";
import { startPolling } from "./api";
import c from "./Customers.module.css";
import { hasNavBar, SiteHeader, SiteMenu } from "./SiteChrome";
import styles from "./Todo.module.css";

// The prospects (the CRM) inside the app, Customers' first tab (19 Nov 2026, Niko: "add the CRM into the ERP app, change
// visits to customers and put the crm inside of that along with the existing site visit stuff"). The same lists and
// prospect pages as the admin pages (components/crm, lib/crmPage.ts), here in one page: a prospect opens in place and
// "All prospects" comes back to the list where it was left. The office sees everything; a login with Customers (Rahma's)
// everything but making buyer logins and deleting prospects. Each change is followed by the CRM read again (the admin
// pages are drawn again by the server instead), and what's on screen is read again every minute while it's open.

export interface ProspectsData {
  list: CrmListData;
  /** The prospect the address opened. */
  page?: ProspectData;
  /** The list's tab and filter the address asked for. */
  at?: { view?: string; stage?: string };
}

/** What's shown: a prospect, or the list at a tab (listKey changes when a tab is asked for, to start the list on it). */
type Shown = { id: string | null; view: string; stage: string; listKey: number; at: number };

/** The address of what's shown. */
const pathOf = (s: Shown) => (s.id ? prospectHref(s.id) : appListHref(s.view && s.view !== "today" ? { view: s.view, stage: s.stage || undefined } : undefined));

export function ProspectsApp({
  me,
  active,
  initial,
  startedOffline,
  fresh,
  tabs,
  ask,
  onPath,
}: {
  me: TodoMe;
  active: boolean;
  initial: ProspectsData | null;
  startedOffline: boolean;
  fresh: boolean;
  tabs?: React.ReactNode;
  /** A prospect or the list asked for from outside (the back button, a visit's Record, an alert). */
  ask: { to: CrmView; at: number } | null;
  /** The part's own address (a prospect's page, or the list), for the bar to come back to. */
  onPath: (path: string) => void;
}) {
  const [list, setList] = useState<CrmListData | null>(initial?.list ?? null);
  const [pages, setPages] = useState<Record<string, ProspectData>>(() => (initial?.page ? { [initial.page.lead._id]: initial.page } : {}));
  const [shown, setShown] = useState<Shown>(() => ({
    id: initial?.page?.lead._id ?? null,
    view: initial?.at?.view || "today",
    stage: initial?.at?.stage ?? "",
    listKey: 0,
    at: 0,
  }));
  const [missing, setMissing] = useState<string | null>(null);
  const [offline, setOffline] = useState(startedOffline);
  const [signedOut, setSignedOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const shownRef = useRef(shown);
  const activeRef = useRef(active);
  const hasList = useRef(list !== null);
  const listStale = useRef(false);
  const listScroll = useRef(0);
  const skipFirst = useRef(fresh);
  // An answer that started before the newest one already shown is old news (a change saved meanwhile).
  const newest = useRef({ list: 0, page: 0 });

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const get = useCallback(async (url: string) => {
    const response = await fetch(url, { cache: "no-store" });
    if (response.status === 401 || response.status === 403) {
      setSignedOut(true);
      throw new Error("signed out");
    }
    return response;
  }, []);

  const readList = useCallback(async () => {
    const started = Date.now();
    try {
      const response = await get("/api/crm");
      if (!response.ok) throw new Error(String(response.status));
      const next = (await response.json()) as CrmListData;
      setOffline(false);
      if (started < newest.current.list) return;
      newest.current.list = started;
      listStale.current = false;
      hasList.current = true;
      setList(next);
    } catch {
      setOffline(true);
    }
  }, [get]);

  const readPage = useCallback(
    async (id: string) => {
      const started = Date.now();
      try {
        const response = await get(`/api/crm?id=${encodeURIComponent(id)}`);
        if (response.status === 404) {
          setMissing(id);
          return;
        }
        if (!response.ok) throw new Error(String(response.status));
        const next = (await response.json()) as ProspectData;
        setOffline(false);
        if (started < newest.current.page) return;
        newest.current.page = started;
        setPages((all) => ({ ...all, [id]: next }));
      } catch {
        setOffline(true);
      }
    },
    [get]
  );

  // What's on screen, read again: a prospect's page (the list follows when it's next shown), or the list.
  const refresh = useCallback(async () => {
    const id = shownRef.current.id;
    if (id) {
      listStale.current = true;
      await readPage(id);
    } else await readList();
  }, [readList, readPage]);

  // The address follows what's shown (the bar comes back to it).
  useEffect(() => {
    onPath(pathOf(shown));
  }, [shown, onPath]);

  const show = useCallback(
    (to: CrmView, push: boolean) => {
      const prev = shownRef.current;
      if (!prev.id && to.id) listScroll.current = window.scrollY;
      if (!to.id && to.view) listScroll.current = 0;
      const next: Shown = to.id
        ? { ...prev, id: to.id, at: Date.now() }
        : to.view
          ? { id: null, view: to.view, stage: to.stage ?? "", listKey: prev.listKey + 1, at: Date.now() }
          : { ...prev, id: null, at: Date.now() };
      shownRef.current = next;
      setShown(next);
      setMissing(null);
      if (push && activeRef.current) window.history.pushState(null, "", pathOf(next));
      if (to.id) void readPage(to.id);
      else if (listStale.current || !hasList.current) void readList();
    },
    [readList, readPage]
  );

  // Opened at a prospect's address that couldn't be read with the page (no signal): it's read now.
  useEffect(() => {
    if (initial) return;
    const id = prospectOfPath(window.location.pathname);
    if (id) show({ id }, false);
    // Once, when the part first opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Asked from outside (the phone's back button, a Record link, an alert): no new history entry.
  const lastAsk = useRef(0);
  useEffect(() => {
    if (!ask || ask.at === lastAsk.current) return;
    lastAsk.current = ask.at;
    show(ask.to, false);
  }, [ask, show]);

  // A prospect opens at its top; the list comes back where it was.
  useLayoutEffect(() => {
    if (!activeRef.current || !shown.at) return;
    window.scrollTo(0, shown.id ? 0 : listScroll.current);
  }, [shown.at, shown.id]);

  // Fresh while on screen: read now (unless the page just brought it), then every minute (every 3 when left alone).
  useEffect(() => {
    if (!active) return;
    if (skipFirst.current) skipFirst.current = false;
    else void refresh();
    return startPolling(refresh, 60_000, 180_000);
  }, [active, refresh]);

  const host: CrmHostApi = useMemo(
    () => ({
      inApp: true,
      office: me.kind === "admin",
      me: me.kind === "admin" ? undefined : me.id,
      leadHref: prospectHref,
      listHref: appListHref,
      go: (to) => show(to, true),
      refresh,
    }),
    [me.kind, me.id, show, refresh]
  );

  const page = shown.id ? pages[shown.id] : undefined;
  // The viewer's own list (Rahma's is what she was given; the office's the rest). A list kept from before the team came
  // has none: everything is the office's then.
  const team = list?.team ?? [];
  const viewer = me.kind === "admin" ? "" : me.id;
  const counts = list ? buildCrmData(list.leads.filter((l) => ownerOf(l, team) === viewer), list.today) : null;
  const waiting = counts ? counts.meDue.length + counts.needsStep.length : 0;
  const sub = !list ? "Loading…" : `${waiting ? `${waiting} waiting on you · ` : ""}${list.leads.length} prospects`;

  return (
    <>
      <SiteHeader eyebrow="Customers" title="Prospects" sub={sub} onMenu={() => setMenuOpen(true)}>
        {tabs}
      </SiteHeader>
      {signedOut && (
        <div className={styles.banner} role="alert">
          {/* A whole new page on purpose: it brings the sign-in. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          You&rsquo;ve been signed out. <a href="/todo/customers">Sign in again</a>
        </div>
      )}
      {offline && !signedOut && (
        <div className={styles.banner} role="status">
          No signal: showing the prospects as they were.
        </div>
      )}
      <main className={`${styles.main} ${c.main}`}>
        <CrmHostProvider value={host}>
          <div className={`${c.crmApp} ${hasNavBar(me) ? c.withBar : ""}`}>
            <ToastProvider>
              <div hidden={Boolean(shown.id)}>
                {list ? (
                  <CrmLists key={shown.listKey} leads={list.leads} units={list.units} today={list.today} team={team} view={shown.view} stage={shown.stage} title={null} />
                ) : (
                  !offline && <p className={styles.loading}>Loading the prospects…</p>
                )}
              </div>
              {shown.id &&
                (page ? (
                  <ProspectView key={page.lead._id} data={page} />
                ) : missing === shown.id ? (
                  <div className={c.missing}>
                    <p>That prospect is no longer in the CRM.</p>
                    <button type="button" className={styles.sheetCancel} onClick={() => show({}, true)}>
                      All prospects
                    </button>
                  </div>
                ) : (
                  <p className={styles.loading}>Opening…</p>
                ))}
            </ToastProvider>
          </div>
        </CrmHostProvider>
      </main>
      {menuOpen && <SiteMenu me={me} onClose={() => setMenuOpen(false)} onRefresh={() => void refresh()} onLogins={() => setAccessOpen(true)} />}
      {accessOpen && <AccessSheet onClose={() => setAccessOpen(false)} />}
    </>
  );
}
