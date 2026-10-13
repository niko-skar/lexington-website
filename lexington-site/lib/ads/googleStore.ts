import "server-only";

import { getBuyersClient } from "@/lib/sanity/buyersClient";

import type { GoogleRow } from "./google";

/**
 * The last report the Google Ads script sent, kept as one document in the
 * private buyers dataset (`adReport`, id `ad-report-google`; outside production
 * `ad-report-google-dev`). Each report replaces the one before: the script sends
 * the whole last 30 days every hour.
 */

function reportId(): string {
  return process.env.VERCEL_ENV === "production" ? "ad-report-google" : "ad-report-google-dev";
}

interface StoredRow extends GoogleRow {
  _key: string;
}

export async function saveGoogleReport(rows: readonly GoogleRow[], receivedAt: string): Promise<void> {
  const stored: StoredRow[] = rows.map((row, index) => ({ _key: `r${index}`, ...row }));
  await getBuyersClient().createOrReplace({ _id: reportId(), _type: "adReport", source: "google", receivedAt, rows: stored });
}

export async function readGoogleReport(): Promise<{ rows: GoogleRow[]; receivedAt: string | null; error: string | null }> {
  try {
    const doc = await getBuyersClient().fetch<{ rows?: StoredRow[]; receivedAt?: string } | null>(`*[_id == $id][0]{rows, receivedAt}`, { id: reportId() });
    const rows = (doc?.rows ?? []).map((row) => ({
      day: row.day,
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      currency: row.currency,
      spend: row.spend,
      clicks: row.clicks,
      impressions: row.impressions,
      conversions: row.conversions ?? null,
    }));
    return { rows, receivedAt: doc?.receivedAt ?? null, error: null };
  } catch (error) {
    return { rows: [], receivedAt: null, error: error instanceof Error ? error.message : "unknown error" };
  }
}
