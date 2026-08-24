import { pageMetadata } from "@/lib/seo";
import { client } from "@/lib/sanity/client";
import { constructionUpdatesQuery, siteSettingsQuery } from "@/lib/sanity/queries";
import type { ConstructionUpdate, SiteSettings } from "@/lib/sanity/types";

import { PageIntro } from "@/components/PageIntro";
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
  const [updates, siteSettings] = await Promise.all([
    client.fetch<ConstructionUpdate[]>(constructionUpdatesQuery),
    client.fetch<SiteSettings>(siteSettingsQuery),
  ]);

  return (
    <>
      <PageIntro {...siteSettings.progressIntro} />

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
