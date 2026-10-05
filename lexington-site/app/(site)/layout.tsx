import { client } from "@/lib/sanity/client";
import { siteSettingsQuery } from "@/lib/sanity/queries";
import type { SiteSettings } from "@/lib/sanity/types";

import { SiteHeader } from "@/components/SiteHeader";
import { PromoBanner } from "@/components/PromoBanner";
import { SiteFooter } from "@/components/SiteFooter";
import { WhatsAppButton } from "@/components/WhatsAppButton";

export default async function SiteLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const siteSettings = await client.fetch<SiteSettings>(siteSettingsQuery);
  const banner = siteSettings.promoBanner;

  return (
    <>
      <a href="#main" className="skipLink">
        Skip to content
      </a>
      <SiteHeader />
      {banner?.enabled && banner.message && <PromoBanner message={banner.message} />}
      {/* The page itself: what screen readers jump to, and what the skip link lands on. */}
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <SiteFooter />
      <WhatsAppButton />
    </>
  );
}
