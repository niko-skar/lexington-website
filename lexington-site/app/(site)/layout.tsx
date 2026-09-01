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
      <SiteHeader />
      {banner?.enabled && banner.message && <PromoBanner message={banner.message} />}
      {children}
      <SiteFooter />
      <WhatsAppButton />
    </>
  );
}
