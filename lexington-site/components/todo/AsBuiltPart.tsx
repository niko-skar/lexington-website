"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { AsBuiltApp, type AsBuiltFrame, type AsBuiltTab } from "@/components/asbuilt/AsBuiltApp";
import { ToastProvider } from "@/components/crm/Toasts";
import type { Floor } from "@/lib/asbuilt/types";
import type { TodoMe } from "@/lib/todo/shared";
import { AccessSheet } from "./AccessSheet";
import { SiteHeader, SiteMenu } from "./SiteChrome";
import s from "./Site.module.css";
import styles from "./Todo.module.css";

// The as-built record inside the site app (Niko, 10 Nov 2026: "put the as build dimensions for the building onto the
// app as well"): every floor's grid, columns, lift cores, openings and slab edges as drawn and as measured, the same
// record as the admin page's (components/asbuilt), the office only. It's read once, when the part first opens (it's
// big, and it saves by itself after that).
// In the app's own look (Niko, 26 Nov 2026: "make this more like it's native in the app and less like it was lifted
// from a website and just pasted in, so its easier to use and more intuitive"): the floors and the views are the app's
// tabs in its header, the downloads are in the ☰ menu, a floor's drawing notes open in a sheet.

export interface AsBuiltData {
  floors: Floor[];
  /** False on a preview or a laptop: a separate test record. */
  real: boolean;
  /** The floor and view the address asked for, when it was opened by its address. */
  floor?: string;
  view?: AsBuiltTab;
}

export function AsBuiltPart({ me, active, initial, startedOffline }: { me: TodoMe; active: boolean; initial: AsBuiltData | null; startedOffline: boolean }) {
  const [data, setData] = useState<AsBuiltData | null>(initial);
  const [offline, setOffline] = useState(startedOffline);
  const [signedOut, setSignedOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [again, setAgain] = useState(0);
  const loading = useRef(false);

  // One read at a time, and its answer is kept whatever happened meanwhile (another part came on screen and back).
  useEffect(() => {
    if (!active || data || loading.current) return;
    loading.current = true;
    fetch("/api/asbuilt", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) return setSignedOut(true);
        if (!response.ok) throw new Error(String(response.status));
        setData((await response.json()) as AsBuiltData);
        setOffline(false);
      })
      .catch(() => setOffline(true))
      .finally(() => {
        loading.current = false;
      });
  }, [active, data, again]);

  const floors = data?.floors ?? [];
  const startKey = floors.some((f) => f.key === data?.floor) ? data!.floor! : floors.some((f) => f.key === "1") ? "1" : (floors[0]?.key ?? "1");
  const openMenu = () => setMenuOpen(true);

  return (
    <>
      {!data ? (
        <div className={s.asbuiltPart}>
          <SiteHeader title="As-built" sub="Loading…" onMenu={openMenu} />
          {signedOut && (
            <div className={styles.banner} role="alert">
              You&rsquo;ve been signed out. <a href="/todo/asbuilt">Sign in again</a>
            </div>
          )}
          {offline && !signedOut && (
            <div className={styles.banner} role="status">
              No signal: the as-built record couldn&rsquo;t be read.{" "}
              <button type="button" className={s.bannerButton} onClick={() => setAgain((n) => n + 1)}>
                Try again
              </button>
            </div>
          )}
          <main className={`${styles.main} ${s.asbuiltMain}`}>{!offline && !signedOut && <p className={styles.loading}>Loading the as-built record…</p>}</main>
        </div>
      ) : (
        <ToastProvider look={{ list: s.abToasts, toast: s.abToast, undo: s.abToastButton, close: s.abToastClose }}>
          <AsBuiltApp
            initialFloors={data.floors}
            initialKey={startKey}
            initialTab={data.view ?? "plan"}
            realRecord={data.real}
            inApp
            active={active}
            frame={(frame) => <AsBuiltChrome frame={frame} onMenu={openMenu} />}
          />
        </ToastProvider>
      )}
      {menuOpen && (
        <SiteMenu me={me} onClose={() => setMenuOpen(false)} onRefresh={() => window.location.reload()} onLogins={() => setAccessOpen(true)}>
          {data && (
            <div className={styles.menuList}>
              {/* Files from a route handler, not pages: plain links. */}
              <a href="/admin/asbuilt/export?format=csv" download onClick={() => setMenuOpen(false)}>
                <span className={styles.menuGrow}>
                  Download every floor (Excel)
                  <small>Each column, gap and figure, as drawn and as measured</small>
                </span>
              </a>
              <a href="/admin/asbuilt/export?format=json" download onClick={() => setMenuOpen(false)}>
                <span className={styles.menuGrow}>
                  Backup file
                  <small>The whole record, to keep somewhere safe</small>
                </span>
              </a>
            </div>
          )}
        </SiteMenu>
      )}
      {accessOpen && <AccessSheet onClose={() => setAccessOpen(false)} />}
    </>
  );
}

/** The app's header around the record: the floors as a row of tabs, the four views as one switch. */
function AsBuiltChrome({ frame, onMenu }: { frame: AsBuiltFrame; onMenu: () => void }) {
  const { floor, floors, tab, tabs, saving, measured, total } = frame;
  const [about, setAbout] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const notes = floor.notes.length;

  // How tall the header is (it grows on a phone that shows the install tip, and with its two rows of tabs), so the
  // plan fills what's left of the screen and a laptop's panel sticks just under it.
  useEffect(() => {
    const box = wrap.current;
    const header = box?.querySelector("header");
    if (!box || !header) return;
    const measure = () => {
      if (header.offsetHeight > 0) box.style.setProperty("--x-head", `${header.offsetHeight}px`);
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(header);
    return () => watch.disconnect();
  }, []);
  const sub = `Level +${floor.level} · ${saving ? "Saving…" : `${measured} of ${total} measured`}`;
  // "the 1st floor", "the ground floor", "the roof".
  const the = floor.name.charAt(0).toLowerCase() + floor.name.slice(1);

  return (
    <div ref={wrap} className={s.asbuiltPart}>
      <SiteHeader title="As-built" sub={sub} onMenu={onMenu}>
        <FloorTabs floors={floors} current={floor.key} onGo={frame.chooseFloor} />
        <div className={`${styles.tabs} ${styles.tabs4} ${s.abViews}`} role="tablist" aria-label="Views">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={tab === t.key ? styles.tabOn : styles.tab}
              onClick={() => frame.chooseTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </SiteHeader>
      <main className={`${styles.main} ${s.asbuiltMain}`}>
        {frame.body}
        <button type="button" className={s.abAbout} onClick={() => setAbout(true)}>
          <span className={s.abAboutText}>
            Where the {the} comes from
            <small>{notes ? `${notes} drawing ${notes === 1 ? "note" : "notes"} to know about` : "The drawings it was made from"}</small>
          </span>
          <span aria-hidden="true" className={s.abChevron}>
            ›
          </span>
        </button>
      </main>
      {about && (
        <div className={styles.sheetBackdrop}>
          <div className={styles.sheet} role="dialog" aria-label={`Where the ${the} comes from`}>
            <h2 className={styles.sheetTitle}>{floor.name}</h2>
            <p className={styles.sheetNote}>Level +{floor.level}</p>
            <p className={s.abAboutBody}>{floor.source}</p>
            {notes > 0 && (
              <>
                <p className={styles.label}>Drawing notes</p>
                <ul className={s.abNotes}>
                  {floor.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </>
            )}
            <button type="button" className={styles.sheetCancel} onClick={() => setAbout(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The floors, ground to roof, as one row of tabs that slides sideways on a phone, the floor on screen kept in view. */
function FloorTabs({ floors, current, onGo }: { floors: AsBuiltFrame["floors"]; current: string; onGo: (key: string) => void }) {
  const row = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const nav = row.current;
    const on = nav?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (nav && on) nav.scrollLeft = Math.max(0, on.offsetLeft - nav.offsetLeft - (nav.clientWidth - on.clientWidth) / 2);
  }, [current]);
  return (
    <nav ref={row} className={`${styles.finTabs} ${s.abFloors}`} aria-label="Floors">
      {floors.map((f) => (
        <button key={f.key} type="button" className={f.key === current ? styles.finTabOn : styles.finTab} aria-pressed={f.key === current} onClick={() => onGo(f.key)}>
          {f.short}
        </button>
      ))}
    </nav>
  );
}
