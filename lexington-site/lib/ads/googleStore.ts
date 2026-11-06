import "server-only";

import { getBuyersClient } from "@/lib/sanity/buyersClient";

import type { GoogleApplied, GoogleCampaignState, GoogleHealthReport, GoogleRow } from "./google";

/**
 * The last report the Google Ads script sent, kept as one document in the
 * private buyers dataset (`adReport`, id `ad-report-google`; outside production
 * `ad-report-google-dev`). Each report replaces the one before: the script sends
 * the whole last 30 days every hour. What the script last did with the ads
 * autopilot's changes is kept until it does something again.
 */

function reportId(): string {
  return process.env.VERCEL_ENV === "production" ? "ad-report-google" : "ad-report-google-dev";
}

interface StoredRow extends GoogleRow {
  _key: string;
}

export interface GoogleReportExtra {
  /** The script's version: 1 only reports, 2 also makes the autopilot's changes. */
  version: number;
  campaigns: GoogleCampaignState[];
  applied: GoogleApplied[];
  snapshotError: string;
  /** Version 3 on: where the clicks went, what is added to the adverts and what they say. */
  health?: GoogleHealthReport | null;
}

export interface StoredGoogleReport {
  rows: GoogleRow[];
  receivedAt: string | null;
  error: string | null;
  version: number;
  campaigns: GoogleCampaignState[];
  snapshotError: string;
  lastApplied: { at: string; items: GoogleApplied[] } | null;
  health: GoogleHealthReport | null;
}

// Sanity drops nulls; leave them out and put them back when reading.
const withoutNulls = <T extends object>(value: T) => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null));

export async function saveGoogleReport(
  rows: readonly GoogleRow[],
  receivedAt: string,
  extra: GoogleReportExtra = { version: 1, campaigns: [], applied: [], snapshotError: "" }
): Promise<void> {
  const id = reportId();
  const stored: StoredRow[] = rows.map((row, index) => ({ _key: `r${index}`, ...row }));
  let tx = getBuyersClient()
    .transaction()
    .createIfNotExists({ _id: id, _type: "adReport" })
    .patch(id, (p) =>
      p.set({
        source: "google",
        receivedAt,
        rows: stored,
        version: extra.version,
        campaigns: extra.campaigns.map((c, index) => ({ _key: `c${index}`, ...withoutNulls(c) })),
        snapshotError: extra.snapshotError,
        ...(extra.health && {
          health: {
            clickTypes: extra.health.clickTypes.map((c, index) => ({ _key: `t${index}`, ...c })),
            links: extra.health.links.map((l, index) => ({ _key: `l${index}`, ...l })),
            ads: extra.health.ads.map((a, index) => ({ _key: `d${index}`, ...a })),
            error: extra.health.error,
          },
        }),
      })
    );
  if (extra.applied.length) {
    tx = tx.patch(id, (p) =>
      p.set({ lastApplied: { at: receivedAt, items: extra.applied.map((a, index) => ({ _key: `a${index}`, ...withoutNulls(a) })) } })
    );
  }
  await tx.commit();
}

export async function readGoogleReport(): Promise<StoredGoogleReport> {
  try {
    const doc = await getBuyersClient().fetch<{
      rows?: StoredRow[];
      receivedAt?: string;
      version?: number;
      campaigns?: Array<Partial<GoogleCampaignState>>;
      snapshotError?: string;
      lastApplied?: { at?: string; items?: Array<Partial<GoogleApplied>> };
      health?: { clickTypes?: unknown; links?: unknown; ads?: unknown; error?: string };
    } | null>(`*[_id == $id][0]{rows, receivedAt, version, campaigns, snapshotError, lastApplied, health}`, { id: reportId() });
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
    const campaigns = (doc?.campaigns ?? []).map((c) => ({
      id: c.id ?? "",
      name: c.name ?? "",
      status: c.status ?? "",
      servingStatus: c.servingStatus ?? "",
      type: c.type ?? "",
      dailyBudget: c.dailyBudget ?? null,
      shared: c.shared === true,
    }));
    const lastApplied = doc?.lastApplied?.at
      ? {
          at: doc.lastApplied.at,
          items: (doc.lastApplied.items ?? []).map((a) => ({ id: a.id ?? "", did: a.did ?? "", from: a.from ?? null, to: a.to ?? null, error: a.error ?? "" })),
        }
      : null;
    // Sanity's list keys off again.
    const strip = <T,>(list: unknown): T[] =>
      (Array.isArray(list) ? list : []).map((item: Record<string, unknown>) => Object.fromEntries(Object.entries(item).filter(([k]) => k !== "_key")) as T);
    const health: GoogleHealthReport | null = doc?.health
      ? { clickTypes: strip(doc.health.clickTypes), links: strip(doc.health.links), ads: strip(doc.health.ads), error: String(doc.health.error ?? "") }
      : null;
    return {
      rows,
      receivedAt: doc?.receivedAt ?? null,
      error: null,
      version: doc?.version ?? 1,
      campaigns,
      snapshotError: doc?.snapshotError ?? "",
      lastApplied,
      health,
    };
  } catch (error) {
    return {
      rows: [],
      receivedAt: null,
      error: error instanceof Error ? error.message : "unknown error",
      version: 1,
      campaigns: [],
      snapshotError: "",
      lastApplied: null,
      health: null,
    };
  }
}
