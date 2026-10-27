import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { WhatsAppButton } from "@/components/WhatsAppButton";
import {
  GoogleTagManager,
  GoogleTagManagerNoScript,
} from "@/components/analytics/GoogleTagManager";
import { VisitTracker } from "@/components/analytics/VisitTracker";

export default function SiteLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      {/* Google Tag Manager (GA4, Meta Pixel, Google Ads) is mounted here, never in the root
          layout: the site to-do, admin, buyer portal, logins and Studios stay out of the ad
          audiences and GA4. */}
      <GoogleTagManagerNoScript />
      <a href="#main" className="skipLink">
        Skip to content
      </a>
      <SiteHeader />
      {/* The page itself: what screen readers jump to, and what the skip link lands on. */}
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <SiteFooter />
      <WhatsAppButton />
      {/* The anonymous visit record behind the admin dashboard's Visitors tab. */}
      <VisitTracker />
      <GoogleTagManager />
    </>
  );
}
