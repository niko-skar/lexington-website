"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { startVisitRecord, trackPageView } from "@/lib/visits/client";

/**
 * Mounted once in the public site's layout. Renders nothing.
 *
 * Starts the anonymous visit record (`lib/visits/rules.ts`) on the first page
 * and notes each page opened inside the visit. Everything else it watches (taps
 * that do nothing, going straight back, how long a page was open, WhatsApp and
 * phone taps) is read from the page by `lib/visits/client.ts`.
 */
export function VisitTracker() {
  const pathname = usePathname();

  useEffect(() => {
    startVisitRecord();
  }, []);

  useEffect(() => {
    trackPageView(pathname);
  }, [pathname]);

  return null;
}
