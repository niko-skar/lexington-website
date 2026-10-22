import { pageMetadata } from "@/lib/seo";
import { client } from "@/lib/sanity/client";
import { constructionUpdatesQuery, latestProgressReportQuery, siteSettingsQuery } from "@/lib/sanity/queries";
import type { ConstructionUpdate, ProgressReport, SiteSettings } from "@/lib/sanity/types";

import { PageIntro } from "@/components/PageIntro";
import { LatestUpdate } from "@/components/LatestUpdate";
import { ProgressGallery } from "@/components/ProgressGallery";
import { Button } from "@/components/Button";

export const revalidate = 600;

export const metadata = pageMetadata({
  path: "/progress",
  title: "Construction Progress | The Lexington",
  description:
    "Site updates from Shiashie, East Legon — photographs and milestones as The Lexington's eight storeys go up, posted as work continues.",
});

export default async function ProgressPage() {
  const [updates, siteSettings, latest] = await Promise.all([
    client.fetch<ConstructionUpdate[]>(constructionUpdatesQuery),
    client.fetch<SiteSettings>(siteSettingsQuery),
    client.fetch<ProgressReport | null>(latestProgressReportQuery),
  ]);

  return (
    <>
      <PageIntro {...siteSettings.progressIntro} />

      {latest && (
        <section style={{ paddingTop: "clamp(24px, 3vw, 40px)" }}>
          <div className="wrap">
            <LatestUpdate report={latest} />
          </div>
        </section>
      )}

      <section style={{ paddingTop: "clamp(24px, 3vw, 40px)" }}>
        <div className="wrap">
          <ProgressGallery updates={updates} />
        </div>
      </section>

      <section className="section sectionAlt" style={{ textAlign: "center" }}>
        <div className="wrap">
          <div className="eyebrow" style={{ justifyContent: "center", display: "flex" }}>
            Next Step
          </div>
          <h2 style={{ marginTop: 14, fontSize: "var(--fs-600)" }}>
            See pricing by floor.
          </h2>
          <div style={{ marginTop: 32, display: "flex", justifyContent: "center" }}>
            <Button href="/residences" variant="clay">
              View Residences
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
