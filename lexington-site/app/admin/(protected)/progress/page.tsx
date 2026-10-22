import crm from "@/components/crm/Crm.module.css";
import styles from "@/components/progress/Progress.module.css";
import { ProgressReporter } from "@/components/progress/ProgressReporter";
import { claudeConfigured } from "@/lib/ai/claude";
import { knownStages, recentUpdates } from "@/lib/agents/progress";
import { requireAdminPage } from "@/lib/auth/requireAdmin";
import { SITE_URL } from "@/lib/seo";

export const metadata = {
  title: "Site updates | The Lexington",
};

// Publishing waits for Instagram to process every photo of a swipe-through post.
export const maxDuration = 300;

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * The progress reporter (Niko, 22 Oct 2026: "a progress reporter that I can easily feed
 * images from my phone into that automatically updates the website and socials").
 * Made for the phone: add this page to the home screen.
 */
export default async function ProgressAdminPage() {
  await requireAdminPage();
  const [stages, recent] = await Promise.all([knownStages(), recentUpdates()]);
  const socialOn = Boolean(process.env.META_PAGE_ID && process.env.META_PAGE_TOKEN);

  return (
    <main className={crm.crmPage}>
      <h1 className={crm.prospectTitle}>Site updates</h1>
      <p className={crm.sectionHint} style={{ marginBottom: 20, maxWidth: "62ch" }}>
        Photos from the site go to the top of the <a href={`${SITE_URL}/progress`}>Construction Progress page</a> and out on Facebook and
        Instagram in one go. On your phone, add this page to your home screen to open it like an app.
      </p>

      <ProgressReporter stages={stages} aiOn={claudeConfigured()} socialOn={socialOn} />

      <section className={crm.panel}>
        <h2 className={crm.panelTitle}>Recent updates</h2>
        {recent.length === 0 ? (
          <p className={crm.sectionHint}>None posted from here yet.</p>
        ) : (
          <ul className={styles.recent}>
            {recent.map((r) => (
              <li key={r._id} className={styles.recentItem}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a small thumbnail from the image store */}
                {r.thumb ? <img src={r.thumb} alt="" /> : <span />}
                <div>
                  <div>{r.title}</div>
                  <div className={styles.recentMeta}>
                    {shortDate(r.date)} · {r.photos} photo{r.photos === 1 ? "" : "s"} ·{" "}
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
    </main>
  );
}
