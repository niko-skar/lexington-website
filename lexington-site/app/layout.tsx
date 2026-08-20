import type { Metadata } from "next";
import { Playfair_Display, Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

import {
  GoogleTagManager,
  GoogleTagManagerNoScript,
} from "@/components/analytics/GoogleTagManager";
import StructuredData from "@/components/analytics/StructuredData";

import { client } from "@/lib/sanity/client";
import { urlFor } from "@/lib/sanity/image";
import { galleryImagesQuery } from "@/lib/sanity/queries";
import type { GalleryImage } from "@/lib/sanity/types";
import { SITE_DESCRIPTION, SITE_TITLE, SITE_URL } from "@/lib/seo";

import "./globals.css";

const playfairDisplay = Playfair_Display({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// Page-level metadata sets its own title, description and canonical, but never
// openGraph/twitter — so this block applies site-wide as-is, and every page
// keeps the same branded share preview rather than only the home page.
export async function generateMetadata(): Promise<Metadata> {
  const images = await client.fetch<GalleryImage[]>(galleryImagesQuery);
  const heroImage = images.find((i) => i.category === "exterior");
  const ogImageUrl = heroImage
    ? urlFor(heroImage.image).width(1200).height(630).fit("crop").url()
    : undefined;

  return {
    metadataBase: new URL(SITE_URL),
    alternates: { canonical: "/" },
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    icons: {
      icon: "/favicon.svg",
    },
    openGraph: {
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      url: SITE_URL,
      siteName: "The Lexington",
      type: "website",
      locale: "en_GH",
      ...(ogImageUrl && {
        images: [{ url: ogImageUrl, width: 1200, height: 630, alt: heroImage?.alt }],
      }),
    },
    twitter: {
      card: "summary_large_image",
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      ...(ogImageUrl && { images: [ogImageUrl] }),
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-GH" className={`${playfairDisplay.variable} ${inter.variable}`}>
      <body>
        <GoogleTagManagerNoScript />
        {children}
        <GoogleTagManager />
        <StructuredData />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
