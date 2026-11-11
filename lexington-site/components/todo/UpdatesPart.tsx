"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import crm from "@/components/crm/Crm.module.css";
import progress from "@/components/progress/Progress.module.css";
import { ProgressReporter } from "@/components/progress/ProgressReporter";
import type { ReporterData } from "@/lib/agents/progress";
import { SITE_URL } from "@/lib/seo";
import type { TodoMe } from "@/lib/todo/shared";
import { AccessSheet } from "./AccessSheet";
import { SiteHeader, SiteMenu } from "./SiteChrome";
import s from "./Site.module.css";
import styles from "./Todo.module.css";

// Site updates inside the site app (Niko, 11 Nov 2026: "make me the site update thing from the website and put it on the
// app under asbuilt"): the progress reporter of /admin/progress, the same form and the same steps (photos from the phone,
// Claude writes the words, Publish puts them at the top of the website's Construction Progress page and out on Facebook
// and Instagram), under the app's header on a light sheet like As-built. The office only. Read when the part first opens.

export type UpdatesData = ReporterData;

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function UpdatesPart({ me, active, initial, startedOffline }: { me: TodoMe; active: boolean; initial: UpdatesData | null; startedOffline: boolean }) {
  const [data, setData] = useState<UpdatesData | null>(initial);
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
    fetch("/api/updates", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) return setSignedOut(true);
        if (!response.ok) throw new Error(String(response.status));
        setData((await response.json()) as UpdatesData);
        setOffline(false);
      })
      .catch(() => setOffline(true))
      .finally(() => {
        loading.current = false;
      });
  }, [active, data, again]);

  // After Publish: the list of recent updates again, with the new one at the top (the form keeps what it shows).
  const reread = useCallback(() => {
    fetch("/api/updates", { cache: "no-store" })
      .then(async (response) => {
        if (response.ok) setData((await response.json()) as UpdatesData);
      })
      .catch(() => {});
  }, []);

  const last = data?.recent[0];

  return (
    <>
      <SiteHeader
        title="Site updates"
        sub={data ? (last ? `Last update ${shortDate(last.date)}` : "None posted from here yet") : "Loading…"}
        onMenu={() => setMenuOpen(true)}
      />
      {signedOut && (
        <div className={styles.banner} role="alert">
          You&rsquo;ve been signed out. <a href="/todo/updates">Sign in again</a>
        </div>
      )}
      {offline && !signedOut && !data && (
        <div className={styles.banner} role="status">
          No signal: Site updates couldn&rsquo;t be read.{" "}
          <button type="button" className={s.bannerButton} onClick={() => setAgain((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}
      <main className={`${styles.main} ${s.updatesMain}`}>
        {!data ? (
          !offline && !signedOut && <p className={styles.loading}>Loading Site updates…</p>
        ) : (
          <div className={s.updatesSheet}>
            <p className={crm.sectionHint} style={{ marginBottom: 16 }}>
              Photos from the site go to the top of the{" "}
              <a href={`${SITE_URL}/progress`} target="_blank" rel="noreferrer">
                Construction Progress page
              </a>{" "}
              and out on Facebook and Instagram in one go.
            </p>

            <ProgressReporter stages={data.stages} aiOn={data.aiOn} socialOn={data.socialOn} onPublished={reread} />

            <section className={crm.panel}>
              <h2 className={crm.panelTitle}>Recent updates</h2>
              {data.recent.length === 0 ? (
                <p className={crm.sectionHint}>None posted yet.</p>
              ) : (
                <ul className={progress.recent}>
                  {data.recent.map((r) => (
                    <li key={r._id} className={progress.recentItem}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- a small thumbnail from the image store */}
                      {r.thumb ? <img src={r.thumb} alt="" /> : <span />}
                      <div>
                        <div>{r.title}</div>
                        <div className={progress.recentMeta}>
                          {shortDate(r.date)} · {r.photos} photo{r.photos === 1 ? "" : "s"}
                          {(r.facebookUrl || r.instagramUrl) && " · "}
                          {r.facebookUrl && (
                            <a href={r.facebookUrl} target="_blank" rel="noreferrer">
                              Facebook
                            </a>
                          )}
                          {r.instagramUrl && (
                            <a href={r.instagramUrl} target="_blank" rel="noreferrer">
                              Instagram
                            </a>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <p className={crm.sectionHint} style={{ marginTop: 14 }}>
                To take an update down from the website: Studio → Site updates (and its photos under Construction updates). Posts on
                Facebook and Instagram are removed there.
              </p>
            </section>
          </div>
        )}
      </main>
      {menuOpen && <SiteMenu me={me} onClose={() => setMenuOpen(false)} onRefresh={() => window.location.reload()} onLogins={() => setAccessOpen(true)} />}
      {accessOpen && <AccessSheet onClose={() => setAccessOpen(false)} />}
    </>
  );
}
