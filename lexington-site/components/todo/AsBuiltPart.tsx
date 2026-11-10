"use client";

import { useEffect, useRef, useState } from "react";

import { AsBuiltApp, type AsBuiltTab } from "@/components/asbuilt/AsBuiltApp";
import { ToastProvider } from "@/components/crm/Toasts";
import type { Floor } from "@/lib/asbuilt/types";
import type { TodoMe } from "@/lib/todo/shared";
import { AccessSheet } from "./AccessSheet";
import { SiteHeader, SiteMenu } from "./SiteChrome";
import s from "./Site.module.css";
import styles from "./Todo.module.css";

// The as-built record inside the site app (Niko, 10 Nov 2026: "put the as build dimensions for the building onto the
// app as well"): every floor's grid, columns, lift cores, openings and slab edges as drawn and as measured, the same
// record and the same screen as the admin page's (components/asbuilt), under the app's header. The office only. It's
// read once, when the part first opens (it's big, and it saves by itself after that).

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
  const measured = floors.reduce((n, f) => n + [...f.columns, ...f.cores].filter((e) => e.actual || e.w || e.h || e.gx || e.gy || e.edges?.length).length, 0);

  return (
    <>
      <SiteHeader title="As-built" sub={data ? `${floors.length} floors · ${measured} columns and lifts measured` : "Loading…"} onMenu={() => setMenuOpen(true)} />
      {signedOut && (
        <div className={styles.banner} role="alert">
          You&rsquo;ve been signed out. <a href="/todo/asbuilt">Sign in again</a>
        </div>
      )}
      {offline && !signedOut && !data && (
        <div className={styles.banner} role="status">
          No signal: the as-built record couldn&rsquo;t be read.{" "}
          <button type="button" className={s.bannerButton} onClick={() => setAgain((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}
      <main className={`${styles.main} ${s.asbuiltMain}`}>
        {!data ? (
          !offline && !signedOut && <p className={styles.loading}>Loading the as-built record…</p>
        ) : (
          <ToastProvider>
            <AsBuiltApp initialFloors={data.floors} initialKey={startKey} initialTab={data.view ?? "plan"} realRecord={data.real} inApp active={active} />
          </ToastProvider>
        )}
      </main>
      {menuOpen && <SiteMenu me={me} onClose={() => setMenuOpen(false)} onRefresh={() => window.location.reload()} onLogins={() => setAccessOpen(true)} />}
      {accessOpen && <AccessSheet onClose={() => setAccessOpen(false)} />}
    </>
  );
}
