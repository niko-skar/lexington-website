"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { rollcallAccess } from "@/lib/rollcall/shared";
import { ghanaDay } from "@/lib/store/shared";
import type { TodoMe } from "@/lib/todo/shared";
import { AccessSheet } from "./AccessSheet";
import rc from "./Rollcall.module.css";
import { SiteHeader, SiteMenu } from "./SiteChrome";
import styles from "./Todo.module.css";

// The roll call inside the app (Niko, 2 Nov 2026: "roll call right now changes the feel of the whole app to
// accommodate it, it should all be uniform and work very fast"). Its page (public/todo/rollcall.html: the register,
// Payday and the workers, worked out exactly as before) shows in the app's frame under the app's header, with
// Today · Payday · Workers as the header's tabs like the store's, in the app's fonts and colours (the page borrows
// them), and stays loaded while another part is on screen, so coming back to it is instant.

export type RollcallTab = "today" | "week" | "workers";
const TAB_NAMES: Record<RollcallTab, string> = { today: "Today", week: "Payday", workers: "Workers" };
const isTab = (v: unknown): v is RollcallTab => v === "today" || v === "week" || v === "workers";
/** The tab an address asks for: /todo/rollcall#week is Payday. */
export const rollcallTabOf = (hash: string): RollcallTab | null => {
  const t = hash.replace(/^#/, "");
  return isTab(t) ? t : null;
};
const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });

export function RollcallPart({
  me,
  active,
  ask,
  onTab,
}: {
  me: TodoMe;
  active: boolean;
  /** A tab asked for from outside (the home page's Payday tile, the address's #week); "at" makes the same one count again. */
  ask: { tab: RollcallTab; at: number } | null;
  /** The tab on screen now (the address follows it). */
  onTab: (tab: RollcallTab) => void;
}) {
  const can = rollcallAccess(me.sections);
  const tabs = (["today", "week", "workers"] as const).filter((t) => (t === "today" ? can.rollcall : t === "week" ? can.payday : can.workers));
  const [current, setCurrent] = useState<RollcallTab>(tabs[0] ?? "today");
  // The same address on the server and the phone; a tab asked for is sent once the page is in.
  const [src] = useState(() => `/todo/rollcall.html?embed=1#${tabs[0] ?? "today"}`);
  const frame = useRef<HTMLIFrameElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const loaded = useRef(false);
  const wanted = useRef<RollcallTab | null>(null);

  const tell = useCallback((data: Record<string, unknown>) => {
    try {
      frame.current?.contentWindow?.postMessage(data, window.location.origin);
    } catch {
      /* not in yet: sent again when it loads */
    }
  }, []);

  const show = useCallback(
    (tab: RollcallTab) => {
      setCurrent(tab);
      wanted.current = tab;
      if (loaded.current) tell({ type: "rc-tab", tab });
    },
    [tell]
  );

  // A tab asked for from outside.
  useEffect(() => {
    if (!ask || !tabs.includes(ask.tab)) return;
    const timer = setTimeout(() => show(ask.tab), 0);
    return () => clearTimeout(timer);
    // The tabs follow the login, fixed while the app is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask, show]);

  // The page says which tab it shows (it can change from inside: "Edit checklists" opens Workers).
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      const d = e.data as { type?: string; tab?: unknown } | null;
      if (d?.type === "rc-state" && isTab(d.tab)) {
        setCurrent(d.tab);
        onTab(d.tab);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onTab]);

  // While another part is on screen, the page looks for changes less often.
  useEffect(() => {
    if (loaded.current) tell({ type: "rc-active", active });
  }, [active, tell]);

  // The frame fills the screen under the header: above the phone's bar, or right of the laptop's rail.
  useLayoutEffect(() => {
    if (!active) return;
    const measure = () => {
      const top = Math.max(0, Math.round(head.current?.getBoundingClientRect().bottom ?? 0));
      const nav = document.querySelector<HTMLElement>('nav[aria-label="Parts of the app"]');
      const r = nav && nav.getClientRects().length ? nav.getBoundingClientRect() : null;
      const rail = !!r && r.left <= 0 && r.height >= window.innerHeight - 2 && r.width < window.innerWidth / 2;
      const bar = !!r && !rail && r.top > window.innerHeight / 2;
      const left = rail ? Math.round(r!.right) : 0;
      const bottom = bar ? Math.round(window.innerHeight - r!.top) : 0;
      setBox({ top, left, width: window.innerWidth - left, height: Math.max(120, window.innerHeight - top - bottom) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (head.current) ro.observe(head.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [active]);

  return (
    <>
      <div ref={head}>
        <SiteHeader title="Roll call" sub={longDay(ghanaDay())} onMenu={() => setMenuOpen(true)}>
          {tabs.length > 1 && (
            <div className={styles.tabs} role="tablist" aria-label="Roll call">
              {tabs.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={current === t}
                  className={current === t ? styles.tabOn : styles.tab}
                  onClick={() => {
                    show(t);
                    onTab(t);
                  }}
                >
                  {TAB_NAMES[t]}
                </button>
              ))}
            </div>
          )}
        </SiteHeader>
      </div>
      <iframe
        ref={frame}
        src={src}
        title="Roll call"
        className={rc.frame}
        style={box ? { top: box.top, left: box.left, width: box.width, height: box.height } : { visibility: "hidden" }}
        onLoad={() => {
          loaded.current = true;
          tell({ type: "rc-active", active });
          if (wanted.current) tell({ type: "rc-tab", tab: wanted.current });
        }}
      />
      {menuOpen && (
        <SiteMenu
          me={me}
          onClose={() => setMenuOpen(false)}
          onRefresh={() => {
            loaded.current = false;
            frame.current?.contentWindow?.location.reload();
          }}
          onLogins={() => setAccessOpen(true)}
        />
      )}
      {accessOpen && <AccessSheet onClose={() => setAccessOpen(false)} />}
    </>
  );
}
