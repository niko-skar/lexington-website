import type { Metadata } from "next";

/**
 * The apex domain 301s to www, so www is the canonical origin. Everything we
 * hand to search engines — sitemap entries, the robots sitemap pointer,
 * canonical tags and share URLs — has to use it, or every URL we advertise is
 * a redirect hop.
 */
export const SITE_URL = "https://www.lexington.com.gh";

export const SITE_NAME = "The Lexington";

export const SITE_TITLE =
  "The Lexington — Shiashie, East Legon | A Skarlatos & Son Development";

export const SITE_DESCRIPTION =
  "The Lexington: eight storeys of studio to three-bedroom residences and a penthouse duplex in Shiashie, East Legon, Accra. From $72,000. A Skarlatos & Son development.";

/**
 * Sanity stores the address as a single human-readable line that includes a
 * landmark ("… — Opposite Oak Plaza Hotel …"), which schema.org can't parse.
 * These are the same address split into the fields Google expects.
 */
export const POSTAL_ADDRESS = {
  streetAddress: "18 Duala Close",
  addressLocality: "Shiashie, East Legon",
  addressRegion: "Greater Accra",
  addressCountry: "GH",
} as const;

/** Lowest published unit price, used for the AggregateOffer in structured data. */
export const PRICE_FROM_USD = 72000;

/**
 * Per-page metadata. Title and description are unique per route; the canonical
 * is relative because `metadataBase` in the root layout resolves it against
 * SITE_URL. openGraph and twitter are inherited from the root layout, so each
 * page keeps the shared branded share preview.
 */
export function pageMetadata({
  path,
  title,
  description,
}: {
  path: string;
  title: string;
  description: string;
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
  };
}
