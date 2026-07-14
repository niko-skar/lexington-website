import type { Metadata } from "next";
import { Playfair_Display, Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

import { client } from "@/lib/sanity/client";
import { urlFor } from "@/lib/sanity/image";
import { galleryImagesQuery } from "@/lib/sanity/queries";
import type { GalleryImage } from "@/lib/sanity/types";

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

const SITE_TITLE = "The Lexington — Shiashie, East Legon | A Skarlatos & Son Development";
const SITE_DESCRIPTION =
  "The Lexington: eight storeys of one, two and three-bedroom penthouse residences in Shiashie, East Legon. A development by Skarlatos & Son.";

// Page-level metadata exports only ever set a plain `title` string, so this
// openGraph/twitter block (unset at that level) applies site-wide as-is —
// every page gets the same branded share preview, not just the home page.
export async function generateMetadata(): Promise<Metadata> {
  const images = await client.fetch<GalleryImage[]>(galleryImagesQuery);
  const heroImage = images.find((i) => i.category === "exterior");
  const ogImageUrl = heroImage
    ? urlFor(heroImage.image).width(1200).height(630).fit("crop").url()
    : undefined;

  return {
    metadataBase: new URL("https://lexington.com.gh"),
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    icons: {
      icon: "/favicon.svg",
    },
    openGraph: {
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      url: "https://lexington.com.gh",
      siteName: "The Lexington",
      type: "website",
      locale: "en_US",
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
    <html lang="en" className={`${playfairDisplay.variable} ${inter.variable}`}>
      <body>
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
