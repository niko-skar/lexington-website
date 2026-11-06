/**
 * What Google Ads sends the Lexington's dashboard, the script that sends it, and
 * the sums the Ads tab shows.
 *
 * WHY A SCRIPT AND NOT GOOGLE'S API. Google's Ads API needs a Cloud project
 * cleared for production use, which takes days of approval for figures the
 * account can simply say itself. A Google Ads script runs inside the account, as
 * the person who put it there, needs no approval, and posts the last 30 days'
 * numbers to a secret address once an hour. The secret
 * (`GOOGLE_ADS_REPORT_SECRET`) is the only thing that makes that address answer.
 *
 * WHAT IS SENT. Spend, clicks, impressions and conversions for each campaign and
 * day, and (from version 2) each campaign's status and daily budget. Figures only:
 * nothing about who clicked. Version 2 also makes the ads autopilot's changes.
 *
 * Pure: the route (`app/api/ads/google-report`) checks the secret and stores.
 */

export interface GoogleRow {
  /** YYYY-MM-DD, the ad account's day. */
  day: string;
  campaignId: string;
  campaignName: string;
  currency: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number | null;
}

/** The most rows one report may carry: 30 days of a hundred campaigns, with room. */
export const GOOGLE_REPORT_MAX_ROWS = 3000;
/** The most bytes one report may be. */
export const GOOGLE_REPORT_MAX_BYTES = 512 * 1024;
/** Days older than this are not accepted. */
const OLDEST_DAYS = 120;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A YYYY-MM-DD that is a real calendar day, else null. */
export function parseDay(value: unknown): string | null {
  if (typeof value !== "string" || !DAY.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

function shift(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const finite = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
};

export type GoogleReportParse = { ok: true; rows: GoogleRow[] } | { ok: false; error: string };

/**
 * The report's rows, checked. One bad row refuses the whole report: a script that
 * is sending garbage should be told so on its first run, not have half of it stored.
 */
export function parseGoogleReport(body: unknown, nowMs: number): GoogleReportParse {
  const rows = (body as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows)) return { ok: false, error: "The report needs a rows list." };
  if (rows.length > GOOGLE_REPORT_MAX_ROWS) return { ok: false, error: `Too many rows (the most is ${GOOGLE_REPORT_MAX_ROWS}).` };

  const today = new Date(nowMs).toISOString().slice(0, 10);
  const oldest = shift(today, -OLDEST_DAYS);
  const newest = shift(today, 2);
  const out = new Map<string, GoogleRow>();

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] as Record<string, unknown> | null;
    const at = `Row ${index + 1}`;
    if (!row || typeof row !== "object") return { ok: false, error: `${at} is not an object.` };

    const day = parseDay(row.day);
    if (!day) return { ok: false, error: `${at} has no real day (it needs YYYY-MM-DD).` };
    if (day < oldest || day > newest) return { ok: false, error: `${at} is for ${day}, outside the last ${OLDEST_DAYS} days.` };

    const spend = finite(row.spend);
    const clicks = finite(row.clicks);
    const impressions = finite(row.impressions);
    if (spend == null || spend < 0) return { ok: false, error: `${at} has no real spend.` };
    if (clicks == null || clicks < 0) return { ok: false, error: `${at} has no real clicks.` };
    if (impressions == null || impressions < 0) return { ok: false, error: `${at} has no real impressions.` };

    const conversions = row.conversions == null ? null : finite(row.conversions);
    if (row.conversions != null && (conversions == null || conversions < 0)) return { ok: false, error: `${at} has bad conversions.` };

    const currency = typeof row.currency === "string" ? row.currency.trim().toUpperCase() : "";
    if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, error: `${at} needs a three-letter currency.` };

    const campaignId = String(row.campaignId ?? "").trim();
    if (campaignId.length > 64) return { ok: false, error: `${at} has a campaign id that is too long.` };

    // The same campaign and day twice: the later row wins.
    out.set(`${day}|${campaignId}`, {
      day,
      campaignId,
      campaignName: String(row.campaignName ?? "").trim().slice(0, 200),
      currency,
      spend: Math.round(spend * 10_000) / 10_000,
      clicks: Math.round(clicks),
      impressions: Math.round(impressions),
      conversions: conversions == null ? null : Math.round(conversions * 10_000) / 10_000,
    });
  }
  return { ok: true, rows: [...out.values()] };
}

/* --- What the script says about each campaign (version 2 on) ------------------------------- */

export interface GoogleCampaignState {
  id: string;
  name: string;
  /** ENABLED or PAUSED. */
  status: string;
  /** SERVING, ENDED, PENDING, SUSPENDED or NONE. */
  servingStatus: string;
  /** SEARCH, PERFORMANCE_MAX, DISPLAY, VIDEO... */
  type: string;
  /** In the account's currency, a day; null when Google gave none. */
  dailyBudget: number | null;
  /** A budget shared by several campaigns: the autopilot leaves those alone. */
  shared: boolean;
}

/** What the script did with the autopilot's changes on one run. */
export interface GoogleApplied {
  id: string;
  did: string;
  from: number | null;
  to: number | null;
  error: string;
}

/** The campaigns the script sends with its report. Lenient: a bad entry is left out, not the report. */
export function parseGoogleCampaigns(body: unknown): GoogleCampaignState[] {
  const list = (body as { campaigns?: unknown } | null)?.campaigns;
  if (!Array.isArray(list)) return [];
  const out: GoogleCampaignState[] = [];
  for (const item of list.slice(0, 200)) {
    const c = item as Record<string, unknown> | null;
    if (!c || typeof c !== "object") continue;
    const id = String(c.id ?? "").trim();
    if (!/^\d{1,20}$/.test(id)) continue;
    const budget = finite(c.dailyBudget);
    out.push({
      id,
      name: String(c.name ?? "").trim().slice(0, 200),
      status: String(c.status ?? "").trim().toUpperCase().slice(0, 20),
      servingStatus: String(c.servingStatus ?? "").trim().toUpperCase().slice(0, 20),
      type: String(c.type ?? "").trim().toUpperCase().slice(0, 40),
      dailyBudget: budget != null && budget >= 0 ? Math.round(budget * 100) / 100 : null,
      shared: c.shared === true,
    });
  }
  return out;
}

export function parseGoogleApplied(body: unknown): GoogleApplied[] {
  const list = (body as { applied?: unknown } | null)?.applied;
  if (!Array.isArray(list)) return [];
  return list
    .slice(0, 100)
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((a) => ({
      id: String(a.id ?? "").slice(0, 30),
      did: String(a.did ?? "").slice(0, 20),
      from: finite(a.from),
      to: finite(a.to),
      error: String(a.error ?? "").slice(0, 200),
    }));
}

/* --- What the script says about where the clicks go and what the adverts say (version 3 on) --- */

/** Clicks of one kind (Google's click type: URL_CLICKS, CALLS, GET_DIRECTIONS...) for a campaign, the last 7 days. */
export interface GoogleClickType {
  campaignId: string;
  type: string;
  clicks: number;
  spend: number;
}

/**
 * Something added to the adverts, account-wide or for one campaign: a location (the map pins of a Business
 * Profile), or a callout, sitelink or snippet with its words. `resource` is Google's name for the link, which
 * is what the script removes.
 */
export interface GoogleLink {
  resource: string;
  level: "account" | "campaign";
  campaignId: string;
  kind: "location" | "text" | "other";
  text: string;
}

/** A responsive search ad that is switched on, with all its headlines and descriptions. */
export interface GoogleAdText {
  resource: string;
  campaignId: string;
  adGroupId: string;
  texts: string[];
}

export interface GoogleHealthReport {
  clickTypes: GoogleClickType[];
  links: GoogleLink[];
  ads: GoogleAdText[];
  /** What the script couldn't read, in its words. */
  error: string;
}

/** The names of the links and adverts the script may remove or pause, and nothing else. */
export const GOOGLE_RESOURCE = /^customers\/\d{1,20}\/(customerAssetSets|campaignAssetSets|customerAssets|campaignAssets|adGroupAds)\/[\w~.-]{1,120}$/;

/** The version 3 additions, checked. Lenient: a bad entry is left out, not the report. */
export function parseGoogleHealth(body: unknown): GoogleHealthReport | null {
  const health = (body as { health?: unknown } | null)?.health as Record<string, unknown> | null | undefined;
  if (!health || typeof health !== "object") return null;
  const list = (value: unknown, max: number) => (Array.isArray(value) ? value.slice(0, max) : []).filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object");
  const id = (value: unknown) => {
    const s = String(value ?? "").trim();
    return /^\d{1,20}$/.test(s) ? s : "";
  };
  const clickTypes = list(health.clickTypes, 400).flatMap((c) => {
    const clicks = finite(c.clicks);
    const spend = finite(c.spend);
    const type = String(c.type ?? "").trim().toUpperCase().slice(0, 60);
    return clicks == null || clicks < 0 || !type ? [] : [{ campaignId: id(c.campaignId), type, clicks: Math.round(clicks), spend: spend != null && spend >= 0 ? Math.round(spend * 100) / 100 : 0 }];
  });
  const links = list(health.links, 400).flatMap((l): GoogleLink[] => {
    const resource = String(l.resource ?? "").trim();
    if (!GOOGLE_RESOURCE.test(resource)) return [];
    const kind = l.kind === "location" || l.kind === "text" ? l.kind : "other";
    return [{ resource, level: l.level === "campaign" ? "campaign" : "account", campaignId: id(l.campaignId), kind, text: String(l.text ?? "").slice(0, 500) }];
  });
  const ads = list(health.ads, 200).flatMap((a): GoogleAdText[] => {
    const resource = String(a.resource ?? "").trim();
    if (!GOOGLE_RESOURCE.test(resource)) return [];
    const texts = (Array.isArray(a.texts) ? a.texts : []).slice(0, 30).map((t) => String(t ?? "").slice(0, 200)).filter(Boolean);
    return [{ resource, campaignId: id(a.campaignId), adGroupId: id(a.adGroupId), texts }];
  });
  return { clickTypes, links, ads, error: String(health.error ?? "").slice(0, 300) };
}

/* --- The sums the Ads tab shows ------------------------------------------------------------- */

export interface GoogleTotals {
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number | null;
  /** Spend per click, or null with no clicks. */
  cpc: number | null;
  /** Clicks as a share of impressions (0-1), or null with none shown. */
  ctr: number | null;
}

export interface GoogleCampaignLine extends GoogleTotals {
  id: string;
  name: string;
}

export interface GoogleSummary {
  currency: string;
  totals: GoogleTotals;
  campaigns: GoogleCampaignLine[];
  byDay: { day: string; spend: number; clicks: number }[];
}

function totalsOf(rows: readonly GoogleRow[]): GoogleTotals {
  let spend = 0;
  let clicks = 0;
  let impressions = 0;
  let conversions: number | null = null;
  for (const row of rows) {
    spend += row.spend;
    clicks += row.clicks;
    impressions += row.impressions;
    if (row.conversions != null) conversions = (conversions ?? 0) + row.conversions;
  }
  spend = Math.round(spend * 100) / 100;
  return {
    spend,
    clicks,
    impressions,
    conversions: conversions == null ? null : Math.round(conversions * 100) / 100,
    cpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : null,
    ctr: impressions > 0 ? clicks / impressions : null,
  };
}

/** The rows for `days` (YYYY-MM-DD, oldest first) added up, busiest campaign first. */
export function summariseGoogle(rows: readonly GoogleRow[], days: readonly string[]): GoogleSummary {
  const inRange = new Set(days);
  const mine = rows.filter((row) => inRange.has(row.day));
  const campaigns = new Map<string, GoogleRow[]>();
  for (const row of mine) {
    const key = row.campaignId || row.campaignName;
    campaigns.set(key, [...(campaigns.get(key) ?? []), row]);
  }
  const byDay = days.map((day) => {
    const dayRows = mine.filter((row) => row.day === day);
    return { day, spend: Math.round(dayRows.reduce((sum, row) => sum + row.spend, 0) * 100) / 100, clicks: dayRows.reduce((sum, row) => sum + row.clicks, 0) };
  });
  return {
    currency: mine[0]?.currency ?? rows[0]?.currency ?? "USD",
    totals: totalsOf(mine),
    campaigns: [...campaigns.entries()]
      .map(([id, list]) => ({ id, name: [...list].sort((a, b) => (a.day < b.day ? 1 : -1))[0]?.campaignName || "Unnamed campaign", ...totalsOf(list) }))
      .sort((a, b) => b.spend - a.spend),
    byDay,
  };
}

/**
 * The Google Ads script to paste in: Tools, Bulk actions, Scripts, New script.
 * Runs hourly. First it makes the ads autopilot's changes, collected from
 * `planEndpoint` (campaign budgets, pausing and switching back on; each change
 * only until its time runs out, so nothing is ever repeated a day later). Then it
 * sends the last 30 days' figures and each campaign's status and daily budget.
 * `secret` goes into the text, so this is built only on the admin's Connect page.
 *
 * Version 3 (6 Nov 2026) also sends where the clicks went (by click type), what is
 * added to the adverts (locations, callouts, sitelinks, snippets) and the words of
 * each switched-on ad, and makes the daily ads check's fixes: removing a link (the
 * map pins, or words with an old price) or pausing an ad. The map pins of every
 * business in the Google Business account (Kaiser Kitchen's among them) had taken
 * most of the money since August without one visit to the website.
 */
export const GOOGLE_SCRIPT_VERSION = 3;

export function googleAdsScript(args: { endpoint: string; planEndpoint: string; secret: string }): string {
  return `// The Lexington: sends the Google Ads spend and clicks to the website's dashboard, and makes
// the ads autopilot's budget changes (it keeps all the advertising within the monthly budget).
// It also sends where the clicks went and what the adverts say, and makes the daily ads check's
// fixes: taking map pins or out-of-date words off the adverts, or pausing an ad with an old price.
// Paste this into Google Ads: Tools > Bulk actions > Scripts (replace the old one, or New script).
// Then press Authorize, Run once, Save, and under Frequency choose Hourly.
// Only figures and the adverts' own words are sent. Nothing about who clicked.

var VERSION = ${GOOGLE_SCRIPT_VERSION};
var REPORT_URL = ${JSON.stringify(args.endpoint)};
var PLAN_URL = ${JSON.stringify(args.planEndpoint)};
var SECRET = ${JSON.stringify(args.secret)};

function main() {
  var applied = applyPlan();
  var campaigns = [];
  var snapshotError = '';
  try {
    campaigns = campaignStates();
  } catch (e) {
    snapshotError = String(e).slice(0, 300);
  }
  var response = UrlFetchApp.fetch(REPORT_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + SECRET },
    payload: JSON.stringify({ version: VERSION, rows: dailyRows(), campaigns: campaigns, applied: applied, snapshotError: snapshotError, health: adHealth() }),
    muteHttpExceptions: true
  });
  Logger.log('The dashboard answered ' + response.getResponseCode() + ': ' + response.getContentText());
}

// Where the clicks went, what is added to the adverts and what the adverts say: the daily ads check reads these.
function adHealth() {
  var out = { clickTypes: [], links: [], ads: [], error: '' };
  var note = function (what, e) {
    out.error = (out.error ? out.error + ' | ' : '') + what + ': ' + String(e).slice(0, 120);
  };
  try {
    var types = AdsApp.search(
      'SELECT campaign.id, segments.click_type, metrics.clicks, metrics.cost_micros FROM campaign ' +
      'WHERE segments.date DURING LAST_7_DAYS AND metrics.clicks > 0'
    );
    while (types.hasNext()) {
      var t = types.next();
      out.clickTypes.push({ campaignId: String(t.campaign.id), type: t.segments.clickType, clicks: Number(t.metrics.clicks), spend: Number(t.metrics.costMicros) / 1000000 });
    }
  } catch (e) {
    note('click types', e);
  }
  try {
    var sets = AdsApp.search("SELECT customer_asset_set.resource_name, asset_set.type FROM customer_asset_set WHERE customer_asset_set.status = 'ENABLED'");
    while (sets.hasNext()) {
      var s = sets.next();
      out.links.push({ resource: s.customerAssetSet.resourceName, level: 'account', kind: isLocation(s.assetSet.type) ? 'location' : 'other', text: String(s.assetSet.type) });
    }
  } catch (e) {
    note('account asset sets', e);
  }
  try {
    var campaignSets = AdsApp.search(
      'SELECT campaign_asset_set.resource_name, campaign.id, asset_set.type FROM campaign_asset_set ' +
      "WHERE campaign_asset_set.status = 'ENABLED' AND campaign.status != 'REMOVED'"
    );
    while (campaignSets.hasNext()) {
      var c = campaignSets.next();
      out.links.push({ resource: c.campaignAssetSet.resourceName, level: 'campaign', campaignId: String(c.campaign.id), kind: isLocation(c.assetSet.type) ? 'location' : 'other', text: String(c.assetSet.type) });
    }
  } catch (e) {
    note('campaign asset sets', e);
  }
  var assetFields =
    'asset.type, asset.callout_asset.callout_text, asset.sitelink_asset.link_text, asset.sitelink_asset.description1, ' +
    'asset.sitelink_asset.description2, asset.structured_snippet_asset.header, asset.structured_snippet_asset.values';
  try {
    var account = AdsApp.search('SELECT customer_asset.resource_name, customer_asset.field_type, ' + assetFields + " FROM customer_asset WHERE customer_asset.status = 'ENABLED'");
    while (account.hasNext()) {
      var a = account.next();
      out.links.push(assetLink(a.customerAsset.resourceName, 'account', '', a.customerAsset.fieldType, a.asset));
    }
  } catch (e) {
    note('account assets', e);
  }
  try {
    var mine = AdsApp.search(
      'SELECT campaign_asset.resource_name, campaign_asset.field_type, campaign.id, ' + assetFields +
      " FROM campaign_asset WHERE campaign_asset.status = 'ENABLED' AND campaign.status != 'REMOVED'"
    );
    while (mine.hasNext()) {
      var b = mine.next();
      out.links.push(assetLink(b.campaignAsset.resourceName, 'campaign', String(b.campaign.id), b.campaignAsset.fieldType, b.asset));
    }
  } catch (e) {
    note('campaign assets', e);
  }
  try {
    var ads = AdsApp.search(
      'SELECT ad_group_ad.resource_name, campaign.id, ad_group.id, ad_group_ad.ad.responsive_search_ad.headlines, ' +
      "ad_group_ad.ad.responsive_search_ad.descriptions FROM ad_group_ad WHERE ad_group_ad.status = 'ENABLED' " +
      "AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD' AND campaign.status != 'REMOVED' AND ad_group.status != 'REMOVED'"
    );
    while (ads.hasNext()) {
      var d = ads.next();
      var rsa = (d.adGroupAd.ad && d.adGroupAd.ad.responsiveSearchAd) || {};
      var texts = [];
      (rsa.headlines || []).concat(rsa.descriptions || []).forEach(function (part) {
        if (part && part.text) texts.push(part.text);
      });
      out.ads.push({ resource: d.adGroupAd.resourceName, campaignId: String(d.campaign.id), adGroupId: String(d.adGroup.id), texts: texts });
    }
  } catch (e) {
    note('ads', e);
  }
  return out;
}

function isLocation(type) {
  return /LOCATION/.test(String(type || ''));
}

// A callout, sitelink or snippet with its words; a location (map pins) is marked as one.
function assetLink(resource, level, campaignId, fieldType, asset) {
  asset = asset || {};
  var words = [];
  if (asset.calloutAsset) words.push(asset.calloutAsset.calloutText);
  if (asset.sitelinkAsset) words.push(asset.sitelinkAsset.linkText, asset.sitelinkAsset.description1, asset.sitelinkAsset.description2);
  if (asset.structuredSnippetAsset) words.push((asset.structuredSnippetAsset.header || '') + ': ' + (asset.structuredSnippetAsset.values || []).join(', '));
  words = words.filter(function (w) {
    return w;
  });
  var kind = isLocation(fieldType) || isLocation(asset.type) ? 'location' : words.length ? 'text' : 'other';
  return { resource: resource, level: level, campaignId: campaignId, kind: kind, text: words.join(' | ') };
}

// Spend, clicks, views and conversions for each campaign and day, the last 30 days.
function dailyRows() {
  var query =
    'SELECT segments.date, campaign.id, campaign.name, customer.currency_code, ' +
    'metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions ' +
    'FROM campaign WHERE segments.date DURING LAST_30_DAYS';
  var rows = [];
  var found = AdsApp.search(query);
  while (found.hasNext()) {
    var row = found.next();
    rows.push({
      day: row.segments.date,
      campaignId: String(row.campaign.id),
      campaignName: row.campaign.name,
      currency: row.customer.currencyCode,
      spend: Number(row.metrics.costMicros) / 1000000,
      clicks: Number(row.metrics.clicks),
      impressions: Number(row.metrics.impressions),
      conversions: Number(row.metrics.conversions)
    });
  }
  return rows;
}

// Each campaign's status and daily budget, so the autopilot knows where things stand.
function campaignStates() {
  var query =
    'SELECT campaign.id, campaign.name, campaign.status, campaign.serving_status, campaign.advertising_channel_type, ' +
    'campaign_budget.amount_micros, campaign_budget.explicitly_shared ' +
    "FROM campaign WHERE campaign.status != 'REMOVED'";
  var out = [];
  var found = AdsApp.search(query);
  while (found.hasNext()) {
    var row = found.next();
    var budget = row.campaignBudget || {};
    out.push({
      id: String(row.campaign.id),
      name: row.campaign.name,
      status: row.campaign.status,
      servingStatus: row.campaign.servingStatus,
      type: row.campaign.advertisingChannelType,
      dailyBudget: budget.amountMicros != null ? Number(budget.amountMicros) / 1000000 : null,
      shared: budget.explicitlyShared === true
    });
  }
  return out;
}

// The autopilot's changes. Each comes with a time limit: after it, the change is not made.
function applyPlan() {
  var done = [];
  var response = UrlFetchApp.fetch(PLAN_URL, { method: 'get', headers: { Authorization: 'Bearer ' + SECRET }, muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    Logger.log('No changes collected (' + response.getResponseCode() + ').');
    return done;
  }
  var plan = JSON.parse(response.getContentText());
  if (!plan.ok || plan.mode !== 'on' || !plan.validUntil || new Date() > new Date(plan.validUntil)) return done;
  var most = Math.min(Number(plan.maxDaily) || 0, 100);
  applyFixes(plan.fixes || [], done);
  plan.campaigns = plan.campaigns || [];
  for (var i = 0; i < plan.campaigns.length; i++) {
    var want = plan.campaigns[i];
    var campaign = findCampaign(want.id);
    if (!campaign) {
      done.push({ id: want.id, error: 'campaign not found' });
      continue;
    }
    try {
      if (want.status === 'PAUSED' && campaign.isEnabled()) {
        campaign.pause();
        done.push({ id: want.id, did: 'paused' });
      }
      if (want.status === 'ENABLED' && campaign.isPaused()) {
        campaign.enable();
        done.push({ id: want.id, did: 'enabled' });
      }
      if (want.dailyBudget != null) {
        var amount = Math.max(1, Math.min(Number(want.dailyBudget), most));
        var budget = campaign.getBudget();
        if (budget && !budget.isExplicitlyShared() && Math.abs(budget.getAmount() - amount) >= 0.01) {
          var before = budget.getAmount();
          budget.setAmount(amount);
          done.push({ id: want.id, did: 'budget', from: before, to: amount });
        }
      }
    } catch (e) {
      done.push({ id: want.id, error: String(e).slice(0, 200) });
    }
  }
  return done;
}

// The daily ads check's fixes: take a link off the adverts (map pins, or words with an old price), or pause an ad.
// Only those two, and only for Google's names of links and ads.
function applyFixes(fixes, done) {
  var operations = { customerAssetSets: 'customerAssetSetOperation', campaignAssetSets: 'campaignAssetSetOperation', customerAssets: 'customerAssetOperation', campaignAssets: 'campaignAssetOperation' };
  for (var f = 0; f < fixes.length && f < 50; f++) {
    var fix = fixes[f];
    var id = String(fix.id || '').slice(0, 30);
    var name = String(fix.resource || '');
    var kind = (name.match(/^customers\\/\\d+\\/(customerAssetSets|campaignAssetSets|customerAssets|campaignAssets|adGroupAds)\\/[\\w~.-]+$/) || [])[1];
    var operation = {};
    if (kind && fix.op === 'pauseAd' && kind === 'adGroupAds') {
      operation.adGroupAdOperation = { update: { resourceName: name, status: 'PAUSED' }, updateMask: 'status' };
    } else if (kind && fix.op === 'remove' && operations[kind]) {
      operation[operations[kind]] = { remove: name };
    } else {
      done.push({ id: id, error: 'not a change the script makes' });
      continue;
    }
    try {
      var result = AdsApp.mutate(operation);
      if (result.isSuccessful()) done.push({ id: id, did: fix.op === 'pauseAd' ? 'ad paused' : 'removed' });
      else done.push({ id: id, error: String(result.getErrorMessages()).slice(0, 200) });
    } catch (e) {
      done.push({ id: id, error: String(e).slice(0, 200) });
    }
  }
}

// Search, Display, Performance Max, video and shopping campaigns each have their own list.
function findCampaign(id) {
  var kinds = ['campaigns', 'performanceMaxCampaigns', 'videoCampaigns', 'shoppingCampaigns'];
  for (var k = 0; k < kinds.length; k++) {
    try {
      var found = AdsApp[kinds[k]]().withIds([Number(id)]).get();
      if (found.hasNext()) return found.next();
    } catch (e) {}
  }
  return null;
}
`;
}
