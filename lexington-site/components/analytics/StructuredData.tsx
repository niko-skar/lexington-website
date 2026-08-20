import { client } from "@/lib/sanity/client";
import { siteSettingsQuery } from "@/lib/sanity/queries";
import type { SiteSettings } from "@/lib/sanity/types";
import {
  POSTAL_ADDRESS,
  PRICE_FROM_USD,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
} from "@/lib/seo";

/**
 * Prose can't tell a search engine that this is one named development, at one
 * address, with units starting at a known price — it has to infer all of that.
 * JSON-LD states it outright, which is what earns the richer Search result and
 * ties the site to the Business Profile listing in Maps.
 *
 * Phone and email come from Sanity so they can't drift from the contact page.
 */
export default async function StructuredData() {
  const settings = await client.fetch<SiteSettings>(siteSettingsQuery);

  // schema.org wants a dialable string; Sanity stores it formatted for humans
  // ("+233 (0)244 30 5262"), and the leading (0) is a domestic-only prefix.
  const telephone = settings?.contactPhone
    ?.replace(/\(0\)/, "")
    .replace(/[^\d+]/g, "");

  const developer = {
    "@type": "Organization",
    "@id": `${SITE_URL}/#developer`,
    name: "Skarlatos & Son",
    url: SITE_URL,
  };

  const graph = [
    developer,
    {
      "@type": "ApartmentComplex",
      "@id": `${SITE_URL}/#development`,
      name: SITE_NAME,
      description: SITE_DESCRIPTION,
      url: SITE_URL,
      numberOfFloors: 8,
      address: { "@type": "PostalAddress", ...POSTAL_ADDRESS },
      ...(telephone && { telephone }),
      ...(settings?.contactEmail && { email: settings.contactEmail }),
      developer,
      makesOffer: {
        "@type": "AggregateOffer",
        priceCurrency: "USD",
        lowPrice: PRICE_FROM_USD,
        availability: "https://schema.org/PreOrder",
        category: "Residential apartments for sale",
      },
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: SITE_NAME,
      url: SITE_URL,
      publisher: developer,
      inLanguage: "en-GH",
    },
  ];

  return (
    <script
      type="application/ld+json"
      // The payload is our own data, not user input, and JSON.stringify escapes
      // the quotes that would otherwise break out of the script tag.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify({ "@context": "https://schema.org", "@graph": graph }),
      }}
    />
  );
}
