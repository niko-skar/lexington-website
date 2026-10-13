import "server-only";

/**
 * What Meta says the Lexington's adverts did, for the admin dashboard: spend,
 * people reached, link clicks and leads (the Instant Form leads and the
 * website's own), each day, for each advert, by age and by placement.
 *
 * WHAT IS NEEDED. A read-only access token for the ad account, set as
 * `META_ADS_ACCESS_TOKEN` (a system user in The Lexington Apartments business
 * portfolio with "View performance" on the ad account and the `ads_read`
 * permission; the steps are on /admin/dashboard/connect). The ad account's
 * number defaults to the Lexington's own (`META_ADS_ACCOUNT_ID` overrides it).
 * The token is never sent to the browser and goes in a header, not an address.
 *
 * "CLICKS" ARE LINK CLICKS (`inline_link_clicks`): the tap that opens the site
 * or the form, not reactions or "see more".
 *
 * Nothing in here throws: a failure is `{ ok: false, error }` in Meta's own words.
 */

export const DEFAULT_GRAPH_VERSION = "v23.0";
export const LEXINGTON_AD_ACCOUNT = "2037426403800972";

export interface MetaConfig {
  token: string;
  /** Digits only; `act_` is added when asking. */
  accountId: string;
  version: string;
  base: string;
}

/** The configuration, or null when Meta has not been connected. */
export function metaConfig(env: Record<string, string | undefined> = process.env): MetaConfig | null {
  const token = env.META_ADS_ACCESS_TOKEN?.trim();
  if (!token) return null;
  const accountId = (env.META_ADS_ACCOUNT_ID ?? LEXINGTON_AD_ACCOUNT).trim().replace(/^act_/i, "").replace(/\D/g, "") || LEXINGTON_AD_ACCOUNT;
  const version = /^v\d+\.\d+$/.test(env.META_GRAPH_VERSION?.trim() ?? "") ? env.META_GRAPH_VERSION!.trim() : DEFAULT_GRAPH_VERSION;
  // Only for testing against a stand-in server; production always asks Meta.
  const base = env.VERCEL_ENV !== "production" && env.META_GRAPH_BASE ? env.META_GRAPH_BASE.replace(/\/+$/, "") : "https://graph.facebook.com";
  return { token, accountId, version, base };
}

/* --- What Meta sends ------------------------------------------------------------------- */

interface MetaAction {
  action_type?: string;
  value?: string;
}

interface InsightRow {
  date_start?: string;
  ad_id?: string;
  ad_name?: string;
  adset_name?: string;
  campaign_name?: string;
  account_currency?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  inline_link_clicks?: string;
  actions?: MetaAction[];
  age?: string;
  publisher_platform?: string;
  platform_position?: string;
}

interface CampaignRow {
  id?: string;
  name?: string;
  effective_status?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  stop_time?: string;
}

/* --- What the dashboard gets ---------------------------------------------------------------- */

export interface LeadCount {
  /** Every lead Meta counted. */
  leads: number;
  /** Leads from the Instant Form inside Facebook and Instagram. */
  form: number;
  /** Leads from the website's enquiry form (the pixel). */
  site: number;
}

export interface MetaTotals extends LeadCount {
  spend: number;
  impressions: number;
  /** People reached; null where it cannot be added up (across days). */
  reach: number | null;
  linkClicks: number;
  costPerLead: number | null;
  /** Link clicks as a share of impressions (0-1), or null with none shown. */
  ctr: number | null;
}

export interface MetaDay {
  day: string;
  spend: number;
  leads: number;
  linkClicks: number;
}

export interface MetaAdLine extends MetaTotals {
  id: string;
  campaign: string;
  adset: string;
  ad: string;
}

export interface MetaSlice {
  key: string;
  label: string;
  spend: number;
  impressions: number;
  leads: number;
  costPerLead: number | null;
}

export interface MetaCampaign {
  id: string;
  name: string;
  status: string;
  /** The daily budget in the account's currency, or null when it has a lifetime budget. */
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  stopTime: string | null;
}

export interface MetaReport {
  accountId: string;
  currency: string;
  since: string;
  until: string;
  totals: MetaTotals;
  byDay: MetaDay[];
  ads: MetaAdLine[];
  byAge: MetaSlice[];
  byPlacement: MetaSlice[];
  campaigns: MetaCampaign[];
  /** Parts that could not be read (the rest is still shown). */
  partial: string[];
}

export type MetaResult = { ok: true; report: MetaReport } | { ok: false; error: string };

/* --- Reading the numbers (pure) ------------------------------------------------------------- */

const number = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

function actionValue(actions: readonly MetaAction[] | undefined, type: string): number {
  if (!Array.isArray(actions)) return 0;
  const found = actions.find((action) => action?.action_type === type);
  return found ? number(found.value) : 0;
}

/** The leads in a row's `actions`, split by where the form was. */
export function leadsOf(actions: readonly MetaAction[] | undefined): LeadCount {
  const form = Math.max(
    actionValue(actions, "onsite_conversion.lead_grouped"),
    actionValue(actions, "leadgen_grouped"),
    actionValue(actions, "onsite_conversion.lead")
  );
  const site = actionValue(actions, "offsite_conversion.fb_pixel_lead");
  const all = actionValue(actions, "lead");
  return { leads: Math.round(Math.max(all, form + site)), form: Math.round(form), site: Math.round(site) };
}

function totalsOf(row: InsightRow, reachKnown: boolean): MetaTotals {
  const spend = Math.round(number(row.spend) * 100) / 100;
  const impressions = Math.round(number(row.impressions));
  const linkClicks = Math.round(number(row.inline_link_clicks));
  const leads = leadsOf(row.actions);
  return {
    spend,
    impressions,
    reach: reachKnown && row.reach !== undefined ? Math.round(number(row.reach)) : null,
    linkClicks,
    ...leads,
    costPerLead: leads.leads > 0 ? Math.round((spend / leads.leads) * 100) / 100 : null,
    ctr: impressions > 0 ? linkClicks / impressions : null,
  };
}

const PLACEMENT_NAMES: Record<string, string> = {
  "facebook|feed": "Facebook Feed",
  "facebook|story": "Facebook Stories",
  "facebook|facebook_stories": "Facebook Stories",
  "facebook|facebook_reels": "Facebook Reels",
  "facebook|facebook_reels_overlay": "Facebook Reels (overlay)",
  "facebook|marketplace": "Facebook Marketplace",
  "facebook|video_feeds": "Facebook video feeds",
  "facebook|search": "Facebook search results",
  "facebook|instream_video": "Facebook in-stream video",
  "facebook|right_hand_column": "Facebook right column",
  "facebook|facebook_profile_feed": "Facebook profile feed",
  "facebook|notification": "Facebook notifications",
  "instagram|feed": "Instagram Feed",
  "instagram|instagram_stories": "Instagram Stories",
  "instagram|instagram_reels": "Instagram Reels",
  "instagram|instagram_explore": "Instagram Explore",
  "instagram|instagram_explore_grid_home": "Instagram Explore home",
  "instagram|instagram_profile_feed": "Instagram profile feed",
  "instagram|instagram_search": "Instagram search results",
  "messenger|messenger_inbox": "Messenger inbox",
  "messenger|messenger_stories": "Messenger Stories",
};

/** "facebook" + "story" -> "Facebook Stories"; anything unknown in plain words. */
export function placementName(platform: string | undefined, position: string | undefined): string {
  const p = (platform ?? "").toLowerCase();
  const pos = (position ?? "").toLowerCase();
  const known = PLACEMENT_NAMES[`${p}|${pos}`];
  if (known) return known;
  if (p === "audience_network") return "Audience Network (other apps)";
  const words = (text: string) => text.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return [words(p), words(pos)].filter(Boolean).join(" ") || "Other";
}

const STATUS_NAMES: Record<string, string> = {
  ACTIVE: "On",
  PAUSED: "Off",
  CAMPAIGN_PAUSED: "Off",
  ADSET_PAUSED: "Off",
  DELETED: "Deleted",
  ARCHIVED: "Archived",
  IN_PROCESS: "Being set up",
  WITH_ISSUES: "Has a problem",
  PENDING_REVIEW: "In review",
  DISAPPROVED: "Rejected",
  PENDING_BILLING_INFO: "Waiting for payment details",
};

export function statusName(status: string): string {
  return STATUS_NAMES[status] ?? status.replace(/_/g, " ").toLowerCase();
}

function slicesOf(rows: readonly InsightRow[], keyOf: (row: InsightRow) => { key: string; label: string }): MetaSlice[] {
  const slices = new Map<string, MetaSlice>();
  for (const row of rows) {
    const { key, label } = keyOf(row);
    const slice = slices.get(key) ?? { key, label, spend: 0, impressions: 0, leads: 0, costPerLead: null };
    slice.spend = Math.round((slice.spend + number(row.spend)) * 100) / 100;
    slice.impressions += Math.round(number(row.impressions));
    slice.leads += leadsOf(row.actions).leads;
    slices.set(key, slice);
  }
  return [...slices.values()]
    .map((slice) => ({ ...slice, costPerLead: slice.leads > 0 ? Math.round((slice.spend / slice.leads) * 100) / 100 : null }))
    .filter((slice) => slice.spend > 0 || slice.leads > 0 || slice.impressions > 0);
}

/* --- Asking Meta ------------------------------------------------------------------------------ */

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

type Page<T> = { ok: true; rows: T[] } | { ok: false; error: string };

/** One Marketing API list, followed through Meta's `after` cursor (never `paging.next`, which carries the token). */
async function graphList<T>(config: MetaConfig, path: string, params: Record<string, string>, fetchImpl: FetchLike): Promise<Page<T>> {
  const rows: T[] = [];
  let after: string | null = null;
  try {
    for (let page = 0; page < 6; page += 1) {
      const query = new URLSearchParams({ ...params, limit: "500" });
      if (after) query.set("after", after);
      const response = await fetchImpl(`${config.base}/${config.version}/${path}?${query}`, {
        headers: { Authorization: `Bearer ${config.token}` },
        signal: AbortSignal.timeout(12_000),
        cache: "no-store",
      });
      const body = (await response.json().catch(() => null)) as {
        data?: T[];
        paging?: { cursors?: { after?: string }; next?: string };
        error?: { message?: string; code?: number };
      } | null;
      if (!response.ok || body?.error) {
        const message = body?.error?.message ?? `Meta answered ${response.status}`;
        return { ok: false, error: body?.error?.code === 190 ? `Meta no longer accepts the access token (${message})` : message };
      }
      rows.push(...(body?.data ?? []));
      after = body?.paging?.next ? (body.paging.cursors?.after ?? null) : null;
      if (!after) break;
    }
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : "Meta could not be reached" };
  }
  return { ok: true, rows };
}

/**
 * Everything the Ads tab shows for the days `since` to `until` (YYYY-MM-DD,
 * both included). The totals must come back; the rest is shown when it does.
 */
export async function fetchMetaReport(
  config: MetaConfig,
  since: string,
  until: string,
  fetchImpl: FetchLike = fetch
): Promise<MetaResult> {
  const act = `act_${config.accountId}/insights`;
  const timeRange = JSON.stringify({ since, until });
  const base = { time_range: timeRange };
  const totalsFields = "spend,impressions,reach,inline_link_clicks,actions,account_currency";

  const [totals, days, ads, ages, placements, campaigns] = await Promise.all([
    graphList<InsightRow>(config, act, { ...base, level: "account", fields: totalsFields }, fetchImpl),
    graphList<InsightRow>(config, act, { ...base, level: "account", time_increment: "1", fields: "spend,inline_link_clicks,actions" }, fetchImpl),
    graphList<InsightRow>(
      config,
      act,
      { ...base, level: "ad", fields: "ad_id,ad_name,adset_name,campaign_name,spend,impressions,reach,inline_link_clicks,actions" },
      fetchImpl
    ),
    graphList<InsightRow>(config, act, { ...base, level: "account", breakdowns: "age", fields: "spend,impressions,actions" }, fetchImpl),
    graphList<InsightRow>(
      config,
      act,
      { ...base, level: "account", breakdowns: "publisher_platform,platform_position", fields: "spend,impressions,actions" },
      fetchImpl
    ),
    graphList<CampaignRow>(config, `act_${config.accountId}/campaigns`, { fields: "id,name,effective_status,daily_budget,lifetime_budget,stop_time" }, fetchImpl),
  ]);

  if (!totals.ok) return { ok: false, error: totals.error };

  const partial: string[] = [];
  const rowsOf = <T,>(page: Page<T>, name: string): T[] => {
    if (page.ok) return page.rows;
    partial.push(`${name}: ${page.error}`);
    return [];
  };

  const totalRow = totals.rows[0] ?? {};
  const currency = /^[A-Za-z]{3}$/.test(totalRow.account_currency ?? "") ? totalRow.account_currency!.toUpperCase() : "USD";

  // Every day in the range, zero where nothing was spent.
  const dayList: MetaDay[] = [];
  for (let day = since; day <= until; day = nextDay(day)) dayList.push({ day, spend: 0, leads: 0, linkClicks: 0 });
  const dayIndex = new Map(dayList.map((d) => [d.day, d]));
  for (const row of rowsOf(days, "Each day")) {
    const point = row.date_start ? dayIndex.get(row.date_start) : undefined;
    if (!point) continue;
    point.spend = Math.round((point.spend + number(row.spend)) * 100) / 100;
    point.leads += leadsOf(row.actions).leads;
    point.linkClicks += Math.round(number(row.inline_link_clicks));
  }

  const adLines: MetaAdLine[] = rowsOf(ads, "Each advert")
    .map((row) => ({
      id: String(row.ad_id ?? ""),
      campaign: String(row.campaign_name ?? ""),
      adset: String(row.adset_name ?? ""),
      ad: String(row.ad_name ?? "Unnamed advert"),
      ...totalsOf(row, true),
    }))
    .sort((a, b) => b.spend - a.spend);

  const AGE_ORDER = ["13-17", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"];
  const ageRank = (key: string) => {
    const at = AGE_ORDER.indexOf(key);
    return at < 0 ? AGE_ORDER.length : at;
  };
  const byAge = slicesOf(rowsOf(ages, "By age"), (row) => ({ key: row.age ?? "unknown", label: row.age ?? "Unknown" })).sort(
    (a, b) => ageRank(a.key) - ageRank(b.key)
  );
  const byPlacement = slicesOf(rowsOf(placements, "By placement"), (row) => ({
    key: `${row.publisher_platform ?? ""}|${row.platform_position ?? ""}`,
    label: placementName(row.publisher_platform, row.platform_position),
  })).sort((a, b) => b.spend - a.spend);

  const campaignList: MetaCampaign[] = rowsOf(campaigns, "Campaigns")
    .map((row) => ({
      id: String(row.id ?? ""),
      name: String(row.name ?? "Unnamed campaign"),
      status: String(row.effective_status ?? ""),
      dailyBudget: row.daily_budget ? number(row.daily_budget) / 100 : null,
      lifetimeBudget: row.lifetime_budget ? number(row.lifetime_budget) / 100 : null,
      stopTime: row.stop_time ?? null,
    }))
    .filter((campaign) => campaign.status !== "DELETED" && campaign.status !== "ARCHIVED");

  return {
    ok: true,
    report: {
      accountId: config.accountId,
      currency,
      since,
      until,
      totals: totalsOf(totalRow, true),
      byDay: dayList,
      ads: adLines,
      byAge,
      byPlacement,
      campaigns: campaignList,
      partial,
    },
  };
}

function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
