"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { PushState } from "@/lib/alerts/shared";
import type { TodoMe } from "@/lib/todo/shared";
import alerts from "./Alerts.module.css";
import { send } from "./api";
import styles from "./Todo.module.css";

// Phone alerts (Web Push) for whoever is signed in on this phone. The office gets its alerts
// (enquiries, leads, messages handed over, problems, and since 27 Oct 2026 the jobs the foreman
// adds); a site login gets a buzz when the office adds a job to the site list. Niko, 27 Oct 2026:
// "i need a notification if albert adds anything to the to do list, same for him to get
// notifications from me". A phone belongs to whoever opened the app on it last: every start tells
// the website again, so signing in as someone else on the same phone moves its alerts along.
// On an iPhone they only work from the home-screen app (Apple allows them nowhere else).

type Toast = (t: { text: string; tone?: "error" }) => void;
type Support = "yes" | "home-screen" | "no";

const standalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

function supportNow(): Support {
  if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window) return "yes";
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone() ? "home-screen" : "no";
}

const never = () => () => {};
const useSupport = () => useSyncExternalStore<Support>(never, supportNow, () => "yes");
const useDenied = () => useSyncExternalStore(never, () => "Notification" in window && Notification.permission === "denied", () => false);

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

/** Who gets phone alerts: the office, and a site login that opens the to-do list. */
export const getsPhoneAlerts = (me: TodoMe) => me.kind === "admin" || me.sections.includes("todo");

export interface PhoneAlerts {
  /** The website's side (keys set?) and this person's phones; null until it has answered. */
  push: PushState | null;
  support: Support;
  blocked: boolean;
  /** This phone: null while checking. */
  mine: { id: string | null; on: boolean } | null;
  busy: boolean;
  /** Each answers whether it worked; the caller says so (errors are shown here). */
  turnOn: (toast: Toast) => Promise<boolean>;
  turnOff: (toast: Toast) => Promise<boolean>;
  test: (toast: Toast) => Promise<boolean>;
}

/** Phone alerts for the person signed in on this phone. The app holds one for all its parts. */
export function usePhoneAlerts(me: TodoMe): PhoneAlerts {
  const enabled = getsPhoneAlerts(me);
  const support = useSupport();
  const deniedBefore = useDenied();
  const [push, setPush] = useState<PushState | null>(null);
  const [mine, setMine] = useState<{ id: string | null; on: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [deniedNow, setDeniedNow] = useState(false);
  const started = useRef(false);

  // Once per app start: the website's side, and whether this phone gets them. A phone that does is
  // told to the website again (it may have forgotten it, or someone else signed in on it since).
  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    void (async () => {
      try {
        const state = await send<PushState>("/api/alerts/push", "GET");
        setPush(state);
        const sub = state.configured && supportNow() === "yes" ? await thisPhone() : null;
        if (!sub) return setMine({ id: null, on: false });
        const saved = await send<{ id: string; push: PushState }>("/api/alerts/push", "POST", { subscription: sub.toJSON(), device: deviceName() });
        setMine({ id: saved.id, on: true });
        setPush(saved.push);
      } catch {
        setMine((m) => m ?? { id: null, on: false });
      }
    })();
  }, [enabled]);

  const turnOn = useCallback(
    async (toast: Toast) => {
      if (!push?.publicKey) return false;
      setBusy(true);
      try {
        // Asked straight from the tap: iPhones only show the question then.
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setDeniedNow(permission === "denied");
          toast({ text: "Phone alerts need your OK. Tap Allow when the phone asks.", tone: "error" });
          return false;
        }
        const reg = (await navigator.serviceWorker.getRegistration("/todo/")) ?? (await navigator.serviceWorker.register("/todo-sw.js", { scope: "/todo" }));
        await navigator.serviceWorker.ready;
        const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(push.publicKey) }));
        const saved = await send<{ id: string; push: PushState }>("/api/alerts/push", "POST", { subscription: sub.toJSON(), device: deviceName() });
        setMine({ id: saved.id, on: true });
        setPush(saved.push);
        return true;
      } catch (e) {
        toast({ text: e instanceof Error && e.message ? e.message : "Couldn't turn phone alerts on. Try again.", tone: "error" });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [push]
  );

  const turnOff = useCallback(
    async (toast: Toast) => {
      setBusy(true);
      try {
        const sub = await thisPhone();
        const endpoint = sub?.endpoint;
        await sub?.unsubscribe().catch(() => false);
        const result = await send<{ push: PushState }>("/api/alerts/push", "DELETE", mine?.id ? { id: mine.id } : { endpoint });
        setPush(result.push);
        setMine({ id: null, on: false });
        return true;
      } catch (e) {
        toast({ text: e instanceof Error ? e.message : "That didn't work. Try again.", tone: "error" });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [mine]
  );

  const test = useCallback(
    async (toast: Toast) => {
      if (!mine?.id) return false;
      setBusy(true);
      try {
        await send("/api/alerts/push", "POST", { test: mine.id });
        return true;
      } catch (e) {
        toast({ text: e instanceof Error ? e.message : "The test didn't go. Try again.", tone: "error" });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [mine]
  );

  return { push, support, blocked: deniedBefore || deniedNow, mine, busy, turnOn, turnOff, test };
}

/* ---------- the office: the card at the top of Alerts ---------- */

export function OfficePhoneCard({ phone, toast }: { phone: PhoneAlerts; toast: Toast }) {
  const { push, support, blocked, mine, busy } = phone;
  let body: React.ReactNode;
  if (!push) body = <p>Checking this phone…</p>;
  else if (!push.configured) body = <p>Not switched on on the website yet. Everything still lands in this list.</p>;
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
          <b>On for this phone.</b> New enquiries, reservations, Facebook leads, messages handed to you, jobs the foreman adds and problems buzz it.
        </p>
        <div className={alerts.phoneButtons}>
          <button
            type="button"
            className={alerts.primary}
            onClick={async () => {
              if (await phone.test(toast)) toast({ text: "Test sent. It should buzz in a few seconds." });
            }}
            disabled={busy}
          >
            Send a test
          </button>
          <button
            type="button"
            className={alerts.secondary}
            onClick={async () => {
              if (await phone.turnOff(toast)) toast({ text: "Phone alerts are off for this phone. They still land here." });
            }}
            disabled={busy}
          >
            Turn off
          </button>
        </div>
      </>
    );
  else
    body = (
      <>
        <p>Get a buzz on this phone for new enquiries, reservations, Facebook leads, messages handed to you, jobs the foreman adds and problems.</p>
        <div className={alerts.phoneButtons}>
          <button
            type="button"
            className={alerts.primary}
            onClick={async () => {
              if (await phone.turnOn(toast)) toast({ text: "Phone alerts are on. Send a test to see one." });
            }}
            disabled={busy}
          >
            {busy ? "Turning on…" : "Turn on phone alerts"}
          </button>
        </div>
      </>
    );

  const others = push ? push.devices.filter((d) => d.id !== mine?.id).length : 0;
  return (
    <section className={alerts.phone} aria-label="Phone alerts">
      <h2 className={alerts.phoneTitle}>Phone alerts</h2>
      {body}
      {push?.configured && others > 0 && (
        <p className={alerts.phoneMore}>
          Also on {others} other {others === 1 ? "device" : "devices"}.
        </p>
      )}
    </section>
  );
}

/* ---------- a site login (the foreman): a card on the to-do list, and the ☰ menu ---------- */

// "Not now" puts the card away for a few days on this phone; the ☰ menu can still turn them on.
const LATER_KEY = "todo-alerts-later";
const LATER_MS = 3 * 86_400_000;
const useAskedLater = () =>
  useSyncExternalStore(
    never,
    () => {
      try {
        return Date.now() - Number(localStorage.getItem(LATER_KEY) || 0) < LATER_MS;
      } catch {
        return false;
      }
    },
    () => true
  );

function blockedHelp(): string {
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return "On the iPhone: Settings → Notifications → Site to-do → Allow Notifications, then come back here.";
  if (standalone()) return "Press and hold the app's icon, tap App info → Notifications and allow them, then come back here.";
  return "In Chrome tap ⋮ → Settings → Site settings → Notifications and allow lexington.com.gh, then come back here.";
}

/** At the top of a site login's to-do list until this phone gets a buzz for the office's new jobs. */
export function JobAlertsCard({ phone, toast }: { phone: PhoneAlerts; toast: Toast }) {
  const askedLater = useAskedLater();
  const [closed, setClosed] = useState(false);
  const [justOn, setJustOn] = useState(false);
  const { push, support, blocked, mine, busy } = phone;
  if (closed || !push?.configured || support !== "yes" || !mine) return null;
  if (mine.on ? !justOn : askedLater && !justOn) return null;

  const later = () => {
    setClosed(true);
    try {
      localStorage.setItem(LATER_KEY, String(Date.now()));
    } catch {
      /* private mode: it asks again next time */
    }
  };

  let body: React.ReactNode;
  if (mine.on)
    body = (
      <>
        <p>
          <b>On for this phone.</b> A new job from the office buzzes it.
        </p>
        <div className={alerts.phoneButtons}>
          <button
            type="button"
            className={alerts.primary}
            onClick={async () => {
              if (await phone.test(toast)) toast({ text: "Test sent. It should buzz in a few seconds." });
            }}
            disabled={busy}
          >
            Send a test
          </button>
          <button type="button" className={alerts.secondary} onClick={() => setClosed(true)}>
            Done
          </button>
        </div>
      </>
    );
  else if (blocked)
    body = (
      <>
        <p>Phone alerts are blocked for this app. {blockedHelp()}</p>
        <div className={alerts.phoneButtons}>
          <button type="button" className={alerts.secondary} onClick={later}>
            Not now
          </button>
        </div>
      </>
    );
  else
    body = (
      <>
        <p>Get a buzz on this phone when the office adds a job.</p>
        <div className={alerts.phoneButtons}>
          <button
            type="button"
            className={alerts.primary}
            onClick={async () => {
              // Kept on screen through the phone's question, then it shows "On".
              setJustOn(true);
              if (!(await phone.turnOn(toast))) setJustOn(false);
            }}
            disabled={busy}
          >
            {busy ? "Turning on…" : "Turn on phone alerts"}
          </button>
          <button type="button" className={alerts.secondary} onClick={later} disabled={busy}>
            Not now
          </button>
        </div>
      </>
    );

  return (
    <section className={alerts.phone} aria-label="Phone alerts">
      <h2 className={alerts.phoneTitle}>Phone alerts</h2>
      {body}
    </section>
  );
}

/** A site login's ☰ menu: turn the buzz for new jobs on or off, or send a test. */
export function JobAlertsMenu({ phone, toast, onDone }: { phone: PhoneAlerts; toast: Toast; onDone: () => void }) {
  const { push, support, mine, busy } = phone;
  if (!push?.configured || support !== "yes" || !mine) return null;
  return (
    <>
      <p className={styles.label}>Phone alerts</p>
      <div className={styles.menuList}>
        {mine.on ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                onDone();
                if (await phone.test(toast)) toast({ text: "Test sent. It should buzz in a few seconds." });
              }}
            >
              <span className={styles.menuGrow}>
                Send a test alert
                <small>On for this phone: a new job from the office buzzes it</small>
              </span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                onDone();
                if (await phone.turnOff(toast)) toast({ text: "Phone alerts are off for this phone." });
              }}
            >
              Turn off phone alerts
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              onDone();
              if (await phone.turnOn(toast)) toast({ text: "Phone alerts are on. A new job from the office buzzes this phone." });
            }}
          >
            <span className={styles.menuGrow}>
              Turn on phone alerts
              <small>A buzz when the office adds a job</small>
            </span>
          </button>
        )}
      </div>
    </>
  );
}
