"use client";

import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { KIND_LABEL, type AlertsData, type OwnerAlert, type PushState } from "@/lib/alerts/shared";
import type { TodoMe } from "@/lib/todo/shared";
import { AccessSheet } from "./AccessSheet";
import alerts from "./Alerts.module.css";
import { dayName, send, startPolling } from "./api";
import { SiteHeader, SiteMenu } from "./SiteChrome";
import styles from "./Todo.module.css";

// Niko's alerts (the office only), in place of the emails the website used to send him (23 Oct
// 2026). New ones stay marked "New" while the tab is open, then count as read. The card at the top
// turns on phone alerts: the ones he has to act on buzz the phone (the app must be on the iPhone's
// home screen for that; Apple allows it nowhere else).

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
    alert.kind === "enquiry" || alert.kind === "reservation" || alert.kind === "lead" || alert.kind === "chat"
      ? alerts.kindPeople
      : alert.kind === "ads"
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

/* ---------- phone alerts ---------- */

const never = () => () => {};
type Support = "yes" | "home-screen" | "no";
const useSupport = () =>
  useSyncExternalStore<Support>(
    never,
    () => {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window) return "yes";
      return ios && !standalone ? "home-screen" : "no";
    },
    () => "yes"
  );

function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iphone/i.test(ua)) return "iPhone";
  if (/ipad/i.test(ua)) return "iPad";
  if (/android/i.test(ua)) return "Android phone";
  if (/mac os/i.test(ua)) return "Mac";
  if (/windows/i.test(ua)) return "Windows computer";
  return "Phone";
}

/** The website's public key in the form the phone wants it. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function thisPhone(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/todo/");
  return reg ? reg.pushManager.getSubscription() : null;
}

const useDenied = () => useSyncExternalStore(never, () => "Notification" in window && Notification.permission === "denied", () => false);

function PhoneAlerts({ push, onPush, toast }: { push: PushState; onPush: (p: PushState) => void; toast: (t: ToastData) => void }) {
  const support = useSupport();
  const deniedBefore = useDenied();
  const [mine, setMine] = useState<{ id: string | null; on: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [deniedNow, setBlocked] = useState(false);
  const blocked = deniedBefore || deniedNow;
  const checked = useRef(false);

  // Is this phone already getting them? Tell the website again once per start (it may have forgotten it).
  useEffect(() => {
    if (support !== "yes" || !push.configured || checked.current) return;
    checked.current = true;
    void (async () => {
      try {
        const sub = await thisPhone();
        if (!sub) return setMine({ id: null, on: false });
        const saved = await send<{ id: string; push: PushState }>("/api/alerts/push", "POST", { subscription: sub.toJSON(), device: deviceName() });
        setMine({ id: saved.id, on: true });
        onPush(saved.push);
      } catch {
        setMine({ id: null, on: false });
      }
    })();
  }, [support, push.configured, onPush]);

  const turnOn = async () => {
    if (!push.publicKey) return;
    setBusy(true);
    try {
      // Asked straight from the tap: iPhones only show the question then.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setBlocked(permission === "denied");
        toast({ text: "Phone alerts need your OK. Tap Allow when the phone asks.", tone: "error" });
        return;
      }
      const reg = (await navigator.serviceWorker.getRegistration("/todo/")) ?? (await navigator.serviceWorker.register("/todo-sw.js", { scope: "/todo" }));
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(push.publicKey) }));
      const saved = await send<{ id: string; push: PushState }>("/api/alerts/push", "POST", { subscription: sub.toJSON(), device: deviceName() });
      setMine({ id: saved.id, on: true });
      onPush(saved.push);
      toast({ text: "Phone alerts are on. Send a test to see one." });
    } catch (e) {
      toast({ text: e instanceof Error && e.message ? e.message : "Couldn't turn phone alerts on. Try again.", tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    try {
      const sub = await thisPhone();
      const endpoint = sub?.endpoint;
      await sub?.unsubscribe().catch(() => false);
      const result = await send<{ push: PushState }>("/api/alerts/push", "DELETE", mine?.id ? { id: mine.id } : { endpoint });
      onPush(result.push);
      setMine({ id: null, on: false });
      toast({ text: "Phone alerts are off for this phone. They still land here." });
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : "That didn't work. Try again.", tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (!mine?.id) return;
    setBusy(true);
    try {
      await send("/api/alerts/push", "POST", { test: mine.id });
      toast({ text: "Test sent. It should buzz in a few seconds." });
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : "The test didn't go. Try again.", tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const others = push.devices.filter((d) => d.id !== mine?.id).length;
  let body: React.ReactNode;
  if (!push.configured) body = <p>Not switched on on the website yet. Everything still lands in this list.</p>;
  else if (support === "home-screen")
    body = (
      <p>
        To get alerts on this iPhone, open the app from your home screen (Share <span aria-hidden="true">⬆︎</span>, then <b>Add to Home Screen</b>) and turn them on there.
      </p>
    );
  else if (support === "no") body = <p>This browser can&rsquo;t show phone alerts. Everything still lands in this list.</p>;
  else if (blocked && !mine?.on)
    body = (
      <p>
        Alerts are blocked for this app. On the iPhone: <b>Settings → Notifications → Site to-do → Allow Notifications</b>, then come back here.
      </p>
    );
  else if (!mine) body = <p>Checking this phone…</p>;
  else if (mine.on)
    body = (
      <>
        <p>
          <b>On for this phone.</b> New enquiries, reservations, Facebook leads, messages handed to you and problems buzz it.
        </p>
        <div className={alerts.phoneButtons}>
          <button type="button" className={alerts.primary} onClick={() => void test()} disabled={busy}>
            Send a test
          </button>
          <button type="button" className={alerts.secondary} onClick={() => void turnOff()} disabled={busy}>
            Turn off
          </button>
        </div>
      </>
    );
  else
    body = (
      <>
        <p>Get a buzz on this phone for new enquiries, reservations, Facebook leads, messages handed to you and problems.</p>
        <div className={alerts.phoneButtons}>
          <button type="button" className={alerts.primary} onClick={() => void turnOn()} disabled={busy}>
            {busy ? "Turning on…" : "Turn on phone alerts"}
          </button>
        </div>
      </>
    );

  return (
    <section className={alerts.phone} aria-label="Phone alerts">
      <h2 className={alerts.phoneTitle}>Phone alerts</h2>
      {body}
      {push.configured && others > 0 && (
        <p className={alerts.phoneMore}>
          Also on {others} other {others === 1 ? "device" : "devices"}.
        </p>
      )}
    </section>
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

  const onPush = useCallback((push: PushState) => setData((d) => (d ? { ...d, push } : d)), []);

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
            <PhoneAlerts push={data.push} onPush={onPush} toast={showToast} />
            {list.length === 0 ? (
              <p className={styles.empty}>No alerts yet. New enquiries, Facebook leads and messages handed to you will show up here.</p>
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
