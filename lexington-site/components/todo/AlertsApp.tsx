"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import { KIND_LABEL, type AlertsData, type OwnerAlert } from "@/lib/alerts/shared";
import type { TodoMe } from "@/lib/todo/shared";
import { AccessSheet } from "./AccessSheet";
import alerts from "./Alerts.module.css";
import { dayName, send, startPolling } from "./api";
import { OfficePhoneCard, type PhoneAlerts } from "./PhoneAlerts";
import { SiteHeader, SiteMenu } from "./SiteChrome";
import styles from "./Todo.module.css";

// Niko's alerts (the office only), in place of the emails the website used to send him (23 Oct
// 2026). New ones stay marked "New" while the tab is open, then count as read. The card at the top
// turns on phone alerts (./PhoneAlerts): the ones he has to act on buzz the phone (the app must be
// on the iPhone's home screen for that; Apple allows it nowhere else).

type ToastData = { text: string; tone?: "error" };

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** Text with its web addresses as links (older alerts carried them inside the lines). */
function Linked({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noreferrer">
            {part.replace(/^https?:\/\/(www\.)?/, "").slice(0, 48)}
            {part.replace(/^https?:\/\/(www\.)?/, "").length > 48 ? "…" : ""}
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </>
  );
}

function AlertCard({ alert, fresh, opened }: { alert: OwnerAlert; fresh: boolean; opened: boolean }) {
  const tone =
    alert.kind === "enquiry" || alert.kind === "reservation" || alert.kind === "lead" || alert.kind === "chat" || alert.kind === "buyer"
      ? alerts.kindPeople
      : alert.kind === "ads" || alert.kind === "todo" || alert.kind === "bank"
        ? alerts.kindAds
        : alerts.kindQuiet;
  return (
    <article id={alert.id} className={`${alerts.alert} ${fresh ? alerts.fresh : ""} ${opened ? alerts.opened : ""}`}>
      <div className={alerts.alertTop}>
        <span className={`${alerts.kind} ${tone}`}>{KIND_LABEL[alert.kind] ?? "Alert"}</span>
        {fresh && <span className={alerts.newTag}>New</span>}
        <span className={alerts.time}>{time(alert.createdAt)}</span>
      </div>
      <h3 className={alerts.alertTitle}>{alert.title}</h3>
      {alert.lines.length > 0 && (
        <div className={alerts.lines}>
          {alert.lines.map((line, i) =>
            line.startsWith("• ") ? (
              <p key={i} className={alerts.bullet}>
                <Linked text={line.slice(2)} />
              </p>
            ) : (
              <p key={i}>
                <Linked text={line} />
              </p>
            )
          )}
        </div>
      )}
      {alert.links.length > 0 && (
        <div className={alerts.links}>
          {alert.links.map((link) =>
            link.url.startsWith("/") ? (
              <a key={link.url + link.label} href={link.url} className={alerts.linkButton}>
                {link.label}
              </a>
            ) : (
              <a key={link.url + link.label} href={link.url} target="_blank" rel="noreferrer" className={alerts.linkButton}>
                {link.label} <span aria-hidden="true">↗</span>
              </a>
            )
          )}
        </div>
      )}
    </article>
  );
}

/* ---------- the tab ---------- */

export function AlertsApp({
  me,
  active,
  initial,
  startedOffline,
  fresh,
  openAlert,
  onUnread,
  phone,
}: {
  me: TodoMe;
  /** On screen: only then does it keep itself fresh and count alerts as read. */
  active: boolean;
  initial: AlertsData | null;
  startedOffline: boolean;
  fresh: boolean;
  /** Opened from a phone alert: that one is shown first. */
  openAlert?: string;
  onUnread: (n: number) => void;
  /** This phone's alerts (the app keeps them for all its parts). */
  phone: PhoneAlerts;
}) {
  const [data, setData] = useState<AlertsData | null>(initial);
  const [offline, setOffline] = useState(startedOffline);
  const [signedOut, setSignedOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  // The ones that were unread when the tab was opened: marked "New" until it is left.
  const [freshIds, setFreshIds] = useState<Set<string>>(() => new Set());
  const [opened, setOpened] = useState(openAlert ?? "");
  const inFlight = useRef(false);
  const lastLoadedAt = useRef(0);
  const skipFirst = useRef(fresh);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showToast = useCallback((t: ToastData) => {
    clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await fetch("/api/alerts", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        setSignedOut(true);
        return;
      }
      if (!response.ok) throw new Error("refresh failed");
      const next = (await response.json()) as AlertsData;
      lastLoadedAt.current = Date.now();
      setOffline(false);
      setData(next);
      onUnread(next.unread);
    } catch {
      setOffline(true);
    } finally {
      inFlight.current = false;
    }
  }, [onUnread]);

  useEffect(() => {
    if (!active) return;
    if (skipFirst.current) skipFirst.current = false;
    else if (Date.now() - lastLoadedAt.current > 4_000) void refresh();
    return startPolling(refresh, 20_000, 90_000);
  }, [active, refresh]);

  // Open on screen for a moment: the unread ones count as read (they keep their "New" mark until
  // the tab is left, so nothing jumps while he reads).
  const unreadIds = (data?.alerts ?? []).filter((a) => !a.readAt).map((a) => a.id);
  const unreadKey = unreadIds.join(",");
  useEffect(() => {
    if (!active || !unreadKey) return;
    const ids = unreadKey.split(",");
    const timer = setTimeout(async () => {
      setFreshIds((s) => new Set([...s, ...ids]));
      try {
        const result = await send<{ unread: number }>("/api/alerts", "POST", { read: ids });
        const at = new Date().toISOString();
        setData((d) => (d ? { ...d, unread: result.unread, alerts: d.alerts.map((a) => (ids.includes(a.id) && !a.readAt ? { ...a, readAt: at } : a)) } : d));
        onUnread(result.unread);
      } catch {
        /* counted as read next time */
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [active, unreadKey, onUnread]);

  // Leaving the tab: what was new has been seen.
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    if (!active) setFreshIds(new Set());
  }

  // Opened from a phone alert: bring that one into view.
  useEffect(() => {
    if (!active || !opened || !data) return;
    const el = document.getElementById(opened);
    if (el) el.scrollIntoView({ block: "center" });
    const timer = setTimeout(() => setOpened(""), 4000);
    return () => clearTimeout(timer);
  }, [active, opened, data]);

  const list = data?.alerts ?? [];
  const groups: Array<{ day: string; items: OwnerAlert[] }> = [];
  for (const a of list) {
    const day = dayName(a.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(a);
    else groups.push({ day, items: [a] });
  }
  const isFresh = (a: OwnerAlert) => !a.readAt || freshIds.has(a.id);
  const newCount = list.filter(isFresh).length;

  return (
    <>
      <SiteHeader eyebrow="The Lexington" title="Alerts" sub={!data ? "Loading…" : newCount ? `${newCount} new` : "All caught up"} onMenu={() => setMenuOpen(true)} />

      {signedOut && (
        <div className={styles.banner} role="alert">
          You&rsquo;ve been signed out. <a href="/todo/alerts">Sign in again</a>
        </div>
      )}
      {offline && !signedOut && (
        <div className={styles.banner} role="status">
          No signal: showing the alerts as they were.
        </div>
      )}

      <main className={styles.main}>
        {!data ? (
          <p className={styles.loading}>Loading the alerts…</p>
        ) : (
          <>
            <OfficePhoneCard phone={phone} toast={showToast} />
            {list.length === 0 ? (
              <p className={styles.empty}>No alerts yet. New enquiries, Facebook leads, messages handed to you and jobs the foreman adds will show up here.</p>
            ) : (
              groups.map((g) => (
                <section key={g.day} className={styles.group}>
                  <h2 className={styles.groupTitle}>{g.day}</h2>
                  {g.items.map((a) => (
                    <AlertCard key={a.id} alert={a} fresh={isFresh(a)} opened={a.id === opened} />
                  ))}
                </section>
              ))
            )}
          </>
        )}
      </main>

      {menuOpen && <SiteMenu me={me} onClose={() => setMenuOpen(false)} onRefresh={() => void refresh()} onLogins={() => setAccessOpen(true)} />}
      {accessOpen && <AccessSheet onClose={() => setAccessOpen(false)} />}

      {toast && (
        <div className={`${styles.toast} ${toast.tone === "error" ? styles.toastError : ""}`} role="status">
          <span>{toast.text}</span>
        </div>
      )}
    </>
  );
}
