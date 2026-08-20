import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/seo";

const ROUTES = ["", "/residences", "/amenities", "/gallery", "/progress", "/invest", "/about", "/contact"];

/**
 * No `lastModified`: it would have to be the build time, which claims every
 * page changed on every deploy and trains Google to ignore the field. Omitting
 * it lets Google use its own crawl signals instead.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return ROUTES.map((route) => ({
    url: `${SITE_URL}${route}`,
    changeFrequency: route === "/progress" ? "weekly" : "monthly",
    priority: route === "" ? 1 : 0.8,
  }));
}
