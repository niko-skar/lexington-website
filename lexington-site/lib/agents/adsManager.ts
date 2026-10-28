import "server-only";

import { randomUUID } from "node:crypto";

import { claudeConfigured, writeWithClaude } from "@/lib/ai/claude";
import { leadsOf, metaConfig, type MetaConfig } from "@/lib/ads/meta";
import { MetaError, metaGraph } from "@/lib/ads/metaGraph";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { client } from "@/lib/sanity/client";

import {
  ANGLES,
  AD_COPY_SCHEMA,
  AD_COPY_SYSTEM,
  MARKET_CITIES,
  MARKET_NAMES,
  adCopyProblems,
  adCopyPrompt,
  adName,
  planManager,
  readTag,
  templateAdCopy,
  type AdCopy,
  type AdInfo,
  type AdsetInfo,
  type AngleKey,
  type ManagerPlan,
  type Market,
  type NewAd,
} from "./adsManagerCore";
import { pilotSettings, readPilotSwitch, realShares } from "./adsPilot";
import { dayIn, type Holder } from "./adsPilotCore";
import { factCheck } from "./factcheck";
import { loadFactPack } from "./facts";
import { allowedAmounts, factPackText, type FactPack } from "./factsCore";
import { listLeadForms } from "./metaLeads";

/**
 * THE ADS MANAGER (Niko, 22 Oct 2026: "manage the entire ad, the content, the leads, the budget,
 * the conversions, trying new things, everything"). Every morning at 5:30 GMT, before the
 * autopilot sets the budgets, it reads every Facebook / Instagram ad set and ad with 14 days of
 * results, and with the rules in adsManagerCore.ts it:
 * - writes and publishes new ads (Claude writes the words from the website's facts only, each
 *   checked by the fact check and the ad rules; the picture comes from the website's gallery or
 *   the latest site update), keeping two to four live in each ad set, one new idea a week;
 * - switches off ads that spend without real leads, ads Meta rejected, and ads quoting an offer
 *   that has ended (a 00:10 run catches those the night the offer ends);
 * - keeps ad sets running past their end date once they have ads without the offer;
 * - tries the UK and Canada once each, as a new ad set in a housing-ad campaign.
 * It never touches budgets (the autopilot does) and it stops when the autopilot is paused or
 * ADS_PILOT is off; in trial mode (dry) it only works out what it would do.
 *
 * What it did and what it is testing lives in one private document (`agentRun.adsManager`).
 */

const PROD = process.env.VERCEL_ENV === "production";
const RUN_ID = PROD ? "agentRun.adsManager" : "agentRun.adsManager-dev";
const newKey = () => randomUUID().replace(/-/g, "").slice(0, 12);

export interface ManagerChange {
  _key: string;
  day: string;
  kind: "new ad" | "pause" | "keep running" | "new market";
  adsetId: string;
  adsetName: string;
  adId?: string;
  name: string;
  /** The words of a new ad, for the record and the weekly email. */
  words?: string;
  reason: string;
  done: boolean;
  error?: string;
}

export interface Experiment {
  _key: string;
  adId: string;
  adsetId: string;
  market: Market;
  angle: AngleKey;
  offerUntil: string | null;
  picture: string;
  made: string;
  /** Last read: spend and real leads since it started. */
  spend?: number;
  leads?: number;
  /** Switched off (by the manager or anyone): no longer running. */
  ended?: string | null;
}

export interface ManagerRun {
  _id: string;
  _type: "agentRun";
  ranAt: string;
  mode: "on" | "dry" | "paused" | "guard";
  today: string;
  changes: ManagerChange[];
  notes: string[];
  errors: string[];
  experiments?: Experiment[];
  lastNew?: Array<{ _key: string; id: string; day: string }>;
  marketsTried?: string[];
  recent?: ManagerChange[];
}

export async function readManagerRun(): Promise<ManagerRun | null> {
  try {
    return (await getBuyersClient().getDocument<ManagerRun>(RUN_ID)) ?? null;
  } catch {
    return null;
  }
}

// ---- reading the account ----------------------------------------------------------------------

interface CampaignRow {
  id: string;
  name?: string;
  status?: string;
  effective_status?: string;
  stop_time?: string;
}

interface AdsetRow {
  id: string;
  name?: string;
  campaign_id?: string;
  status?: string;
  effective_status?: string;
  end_time?: string;
  targeting?: { geo_locations?: { countries?: string[]; cities?: Array<{ country?: string }>; regions?: Array<{ country?: string }> } };
}

interface AdRow {
  id: string;
  name?: string;
  adset_id?: string;
  status?: string;
  effective_status?: string;
  created_time?: string;
  creative?: {
    id?: string;
    body?: string;
    title?: string;
    object_story_spec?: { link_data?: { message?: string; name?: string; description?: string } };
  };
}

interface AdInsight {
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  spend?: string;
  frequency?: string;
  actions?: Array<{ action_type?: string; value?: string }>;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function marketOf(row: AdsetRow): Market | null {
  const geo = row.targeting?.geo_locations;
  const countries = new Set([
    ...(geo?.countries ?? []),
    ...(geo?.cities ?? []).map((c) => c.country ?? ""),
    ...(geo?.regions ?? []).map((r) => r.country ?? ""),
  ]);
  if (countries.has("GB")) return "uk";
  if (countries.has("CA")) return "canada";
  if (countries.has("US")) return "us";
  if (countries.has("GH")) return "ghana";
  return null;
}

interface Account {
  today: string;
  campaigns: CampaignRow[];
  adsets: AdsetInfo[];
  ads: AdInfo[];
  /** Per ad, its whole life so far (90 days), for what each angle has done. */
  lifetime: Map<string, { spend: number; leads: number; adsetId: string; name: string }>;
}

async function readAccount(config: MetaConfig, nowMs: number): Promise<Account> {
  const act = `act_${config.accountId}`;
  const tz = await metaGraph<{ timezone_name?: string }>(config, "GET", act, { fields: "timezone_name" });
  const today = dayIn(tz.timezone_name, nowMs);
  const shift = (d: number) => {
    const t = new Date(`${today}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + d);
    return t.toISOString().slice(0, 10);
  };
  const range = (days: number) => JSON.stringify({ since: shift(-days), until: shift(-1) });
  const [campaigns, adsets, ads, last14, last90] = await Promise.all([
    metaGraph<{ data?: CampaignRow[] }>(config, "GET", `${act}/campaigns`, { fields: "id,name,status,effective_status,stop_time", limit: "200" }),
    metaGraph<{ data?: AdsetRow[] }>(config, "GET", `${act}/adsets`, {
      fields: "id,name,campaign_id,status,effective_status,end_time,targeting",
      limit: "200",
    }),
    metaGraph<{ data?: AdRow[] }>(config, "GET", `${act}/ads`, {
      fields: "id,name,adset_id,status,effective_status,created_time,creative{id,body,title,object_story_spec}",
      limit: "300",
    }),
    metaGraph<{ data?: AdInsight[] }>(config, "GET", `${act}/insights`, {
      level: "ad",
      time_range: range(14),
      fields: "ad_id,adset_id,spend,frequency,actions",
      limit: "500",
    }),
    metaGraph<{ data?: AdInsight[] }>(config, "GET", `${act}/insights`, {
      level: "ad",
      time_range: range(90),
      fields: "ad_id,ad_name,adset_id,spend,actions",
      limit: "500",
    }),
  ]);

  const GONE = new Set(["DELETED", "ARCHIVED"]);
  const campaignOn = new Map((campaigns.data ?? []).map((c) => [c.id, c.status === "ACTIVE" && !GONE.has(c.effective_status ?? "")]));
  const sets: AdsetInfo[] = (adsets.data ?? [])
    .filter((s) => !GONE.has(s.effective_status ?? s.status ?? ""))
    .map((s) => {
      const ended = Boolean(s.end_time && Date.parse(s.end_time) <= nowMs);
      return {
        id: s.id,
        name: s.name ?? "Ad set",
        campaignId: s.campaign_id ?? "",
        market: marketOf(s),
        status: ended ? "ended" : s.status === "ACTIVE" && campaignOn.get(s.campaign_id ?? "") ? "active" : "paused",
        endDay: s.end_time ? dayIn(tz.timezone_name, Date.parse(s.end_time)) : null,
      };
    });
  const stats = new Map((last14.data ?? []).map((r) => [r.ad_id ?? "", r]));
  const adList: AdInfo[] = (ads.data ?? [])
    .filter((a) => !GONE.has(a.effective_status ?? a.status ?? ""))
    .map((a) => {
      const link = a.creative?.object_story_spec?.link_data;
      const text = [a.creative?.body ?? link?.message ?? "", a.creative?.title ?? link?.name ?? "", link?.description ?? ""].filter(Boolean).join("\n");
      const s = stats.get(a.id);
      return {
        id: a.id,
        name: a.name ?? "Ad",
        adsetId: a.adset_id ?? "",
        status: a.effective_status === "DISAPPROVED" ? "rejected" : a.status === "ACTIVE" ? "live" : "paused",
        text,
        tag: readTag(a.name ?? ""),
        last14: { spend: num(s?.spend), leads: leadsOf(s?.actions).leads, frequency: num(s?.frequency) },
      };
    });
  const lifetime = new Map(
    (last90.data ?? []).map((r) => [r.ad_id ?? "", { spend: num(r.spend), leads: leadsOf(r.actions).leads, adsetId: r.adset_id ?? "", name: r.ad_name ?? "" }])
  );
  return { today, campaigns: campaigns.data ?? [], adsets: sets, ads: adList, lifetime };
}

// ---- pictures -----------------------------------------------------------------------------------

interface Picture {
  assetId: string;
  url: string;
  category: string;
  alt: string;
  w: number;
  h: number;
}

/** The website's gallery and the latest site-update photos, without people's names or family pictures. */
async function pictures(): Promise<Picture[]> {
  const [gallery, updates] = await Promise.all([
    client.fetch<Picture[]>(
      `*[_type == "galleryImage" && defined(image.asset) && category in ["exterior","interior","amenity","progress","floorplan"]]{
        "assetId": image.asset._ref, "url": image.asset->url, category, "alt": coalesce(alt, ""),
        "w": image.asset->metadata.dimensions.width, "h": image.asset->metadata.dimensions.height }`,
      {},
      { cache: "no-store" }
    ),
    client.fetch<Array<{ photos?: Picture[] }>>(
      `*[_type == "progressReport"] | order(date desc)[0...3]{ "photos": photos[defined(image.asset)]{
        "assetId": image.asset._ref, "url": image.asset->url, "category": "progress", "alt": coalesce(alt, ""),
        "w": image.asset->metadata.dimensions.width, "h": image.asset->metadata.dimensions.height } }`,
      {},
      { cache: "no-store" }
    ),
  ]);
  const people = /niko|leo|skarlatos|groundbreaking|breaking ground|family/i;
  return [...updates.flatMap((u) => u.photos ?? []), ...gallery].filter((p) => p.url && p.w >= 900 && !people.test(p.alt));
}

/** A picture for this angle that the ad set isn't using, the least used first. */
function choosePicture(all: Picture[], angle: AngleKey, used: Map<string, number>, inSet: Set<string>): Picture | null {
  for (const category of ANGLES[angle].pictures) {
    const options = all.filter((p) => p.category === category && !inSet.has(p.assetId));
    if (options.length) return [...options].sort((a, b) => (used.get(a.assetId) ?? 0) - (used.get(b.assetId) ?? 0) || a.assetId.localeCompare(b.assetId))[0];
  }
  return null;
}

/** The picture cropped for the feed (square, or 4:5 when it stands upright) and sent to Meta; its hash. */
async function uploadPicture(config: MetaConfig, picture: Picture): Promise<string> {
  const upright = picture.h > picture.w * 1.1;
  const url = `${picture.url}?w=1080&h=${upright ? 1350 : 1080}&fit=crop&fm=jpg&q=85`;
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
  if (!response.ok) throw new Error(`The picture could not be fetched (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer()).toString("base64");
  const out = await metaGraph<{ images?: Record<string, { hash?: string }> }>(config, "POST", `act_${config.accountId}/adimages`, { bytes });
  const hash = Object.values(out.images ?? {})[0]?.hash;
  if (!hash) throw new Error("Meta gave no picture back.");
  return hash;
}

// ---- the words ------------------------------------------------------------------------------------

async function writeAd(
  pack: FactPack,
  item: NewAd,
  running: string[],
  learnings: string[]
): Promise<{ copy: AdCopy; writer: "claude" | "template" } | { error: string }> {
  const check = (copy: AdCopy) => [
    ...adCopyProblems(copy, { withOffer: item.withOffer }),
    ...factCheck(`${copy.primary_text}\n${copy.headline}\n${copy.description}`, pack),
  ];
  if (claudeConfigured()) {
    let problems: string[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const prompt = adCopyPrompt({ facts: factPackText(pack), market: item.market, angle: item.angle, withOffer: item.withOffer, running, learnings });
      const written = await writeWithClaude<AdCopy>({
        system: AD_COPY_SYSTEM,
        content: [
          {
            type: "text",
            text: problems.length ? `${prompt}\n\nYour last version had these problems; fix them:\n${problems.map((p) => `- ${p}`).join("\n")}` : prompt,
          },
        ],
        schema: AD_COPY_SCHEMA,
        effort: "medium",
        maxTokens: 6000,
        purpose: "ad copy",
      });
      if (!written.ok) break;
      const copy = {
        primary_text: written.value.primary_text.trim(),
        headline: written.value.headline.trim(),
        description: written.value.description.trim(),
      };
      problems = check(copy);
      if (!problems.length) return { copy, writer: "claude" };
    }
  }
  const plain = templateAdCopy(pack, item.market, item.angle, item.withOffer);
  const problems = check(plain);
  return problems.length ? { error: `No ad passed the checks (${problems.join("; ")}).` } : { copy: plain, writer: "template" };
}

// ---- making the changes --------------------------------------------------------------------------

interface Context {
  config: MetaConfig;
  pack: FactPack;
  pageId: string;
  formId: string;
  igUserId: string | null;
  pictures: Picture[];
  used: Map<string, number>;
  today: string;
}

/** One new ad in an ad set: the words, the picture, the creative, then the ad itself (switched on). */
async function makeAd(
  ctx: Context,
  item: NewAd,
  running: string[],
  learnings: string[],
  inSet: Set<string>
): Promise<{ adId: string; name: string; words: string; picture: string }> {
  const written = await writeAd(ctx.pack, item, running, learnings);
  if ("error" in written) throw new Error(written.error);
  const picture = choosePicture(ctx.pictures, item.angle, ctx.used, inSet);
  if (!picture) throw new Error(`No picture for the ${item.angle} angle.`);
  const hash = await uploadPicture(ctx.config, picture);
  const offerUntil = item.withOffer ? (ctx.pack.offer?.endsOn ?? null) : null;
  const name = adName({ market: item.market, angle: item.angle, made: ctx.today, offerUntil });
  const spec = (withIg: boolean) => ({
    page_id: ctx.pageId,
    ...(withIg && ctx.igUserId ? { instagram_user_id: ctx.igUserId } : {}),
    link_data: {
      image_hash: hash,
      link: "https://fb.me/",
      message: written.copy.primary_text,
      name: written.copy.headline,
      description: written.copy.description,
      call_to_action: { type: "LEARN_MORE", value: { lead_gen_form_id: ctx.formId } },
    },
  });
  const act = `act_${ctx.config.accountId}`;
  let creative: { id?: string };
  try {
    creative = await metaGraph<{ id?: string }>(ctx.config, "POST", `${act}/adcreatives`, { name, object_story_spec: JSON.stringify(spec(true)) });
  } catch (error) {
    // The Instagram account isn't accepted (or the key may not use it): the Page then stands in for it on Instagram.
    if (!ctx.igUserId) throw error;
    creative = await metaGraph<{ id?: string }>(ctx.config, "POST", `${act}/adcreatives`, { name, object_story_spec: JSON.stringify(spec(false)) });
  }
  if (!creative.id) throw new Error("Meta gave no creative back.");
  const ad = await metaGraph<{ id?: string }>(ctx.config, "POST", `${act}/ads`, {
    name,
    adset_id: item.adsetId,
    creative: JSON.stringify({ creative_id: creative.id }),
    status: "ACTIVE",
  });
  if (!ad.id) throw new Error("Meta gave no ad back.");
  ctx.used.set(picture.assetId, (ctx.used.get(picture.assetId) ?? 0) + 1);
  inSet.add(picture.assetId);
  return {
    adId: ad.id,
    name,
    words: `${written.copy.headline} | ${written.copy.primary_text} | ${written.copy.description}${written.writer === "template" ? " (standard wording)" : ""}`,
    picture: picture.assetId,
  };
}

/** A new market: one housing-ad campaign for the UK and Canada (made once), an ad set for the market's cities, two ads. */
async function makeMarket(
  ctx: Context,
  market: "uk" | "canada",
  campaigns: CampaignRow[],
  learnings: string[]
): Promise<{ adsetId: string; ads: Array<{ adId: string; name: string; words: string; picture: string; angle: AngleKey }> }> {
  const act = `act_${ctx.config.accountId}`;
  let campaignId = campaigns.find((c) => (c.name ?? "").startsWith("LEX diaspora"))?.id ?? null;
  if (!campaignId) {
    const made = await metaGraph<{ id?: string }>(ctx.config, "POST", `${act}/campaigns`, {
      name: "LEX diaspora · UK and Canada",
      objective: "OUTCOME_LEADS",
      status: "PAUSED",
      special_ad_categories: JSON.stringify(["HOUSING"]),
      special_ad_category_country: JSON.stringify(["GB", "CA"]),
      daily_budget: "100",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    });
    if (!made.id) throw new Error("Meta gave no campaign back.");
    campaignId = made.id;
  }
  const cities = [];
  for (const c of MARKET_CITIES[market]) {
    const found = await metaGraph<{ data?: Array<{ key?: string; name?: string }> }>(ctx.config, "GET", "search", {
      type: "adgeolocation",
      location_types: JSON.stringify(["city"]),
      q: c.q,
      country_code: c.country,
      limit: "1",
    });
    const key = found.data?.[0]?.key;
    if (key) cities.push({ key, radius: c.radiusKm, distance_unit: "kilometer" });
  }
  if (!cities.length) throw new Error(`Meta found none of the ${MARKET_NAMES[market]} cities.`);
  const set = await metaGraph<{ id?: string }>(ctx.config, "POST", `${act}/adsets`, {
    name: `LEX ${market} · diaspora cities`,
    campaign_id: campaignId,
    optimization_goal: "LEAD_GENERATION",
    billing_event: "IMPRESSIONS",
    destination_type: "ON_AD",
    promoted_object: JSON.stringify({ page_id: ctx.pageId }),
    targeting: JSON.stringify({
      geo_locations: { cities },
      age_min: 18,
      age_max: 65,
      publisher_platforms: ["facebook", "instagram"],
      facebook_positions: ["feed"],
      instagram_positions: ["stream"],
    }),
    status: "PAUSED",
  });
  if (!set.id) throw new Error("Meta gave no ad set back.");
  const ads: Array<{ adId: string; name: string; words: string; picture: string; angle: AngleKey }> = [];
  const inSet = new Set<string>();
  for (const angle of ["abroad", "price"] as const) {
    const made = await makeAd(ctx, { adsetId: set.id, market, angle, withOffer: false, kind: "minimum", reason: "" }, ads.map((a) => a.words), learnings, inSet);
    ads.push({ ...made, angle });
  }
  // Only now, with its ads in place, does it start.
  await metaGraph(ctx.config, "POST", set.id, { status: "ACTIVE" });
  await metaGraph(ctx.config, "POST", campaignId, { status: "ACTIVE" });
  return { adsetId: set.id, ads };
}

// ---- the run ---------------------------------------------------------------------------------------

/** What each angle has brought, over every ad the manager made (90 days), with real leads only. */
function angleResults(account: Account, share: (h: Holder) => number) {
  const out: Partial<Record<AngleKey, { spend: number; leads: number }>> = {};
  for (const [, r] of account.lifetime) {
    const tag = readTag(r.name);
    if (!tag) continue;
    const real = r.leads * share({ channel: "meta", id: r.adsetId, level: "adset", name: "", status: "active", dailyBudget: 0, last14: { spend: 0, leads: 0 } });
    const cur = out[tag.angle] ?? { spend: 0, leads: 0 };
    out[tag.angle] = { spend: cur.spend + r.spend, leads: cur.leads + real };
  }
  return out;
}

function learningsOf(results: Partial<Record<AngleKey, { spend: number; leads: number }>>): string[] {
  return (Object.entries(results) as Array<[AngleKey, { spend: number; leads: number }]>)
    .filter(([, r]) => r.spend >= 10)
    .sort((a, b) => (b[1].leads + 0.5) / (b[1].spend + 5) - (a[1].leads + 0.5) / (a[1].spend + 5))
    .slice(0, 4)
    .map(([angle, r]) => `The "${angle}" angle: ${Math.round(r.leads * 10) / 10} real leads from $${r.spend.toFixed(0)}.`);
}

/**
 * One run. "guard" (00:10 GMT) only switches off ads whose offer has ended and makes what the
 * ad sets need to keep running; "full" (05:30 GMT) does everything. Never throws.
 */
export async function runAdsManager(opts: { mode?: "full" | "guard"; nowMs?: number } = {}): Promise<ManagerRun | { error: string }> {
  const settings = pilotSettings();
  if (settings.mode === "off") return { error: "The ads agents are switched off (ADS_PILOT=off)." };
  const nowMs = opts.nowMs ?? Date.now();
  const ranAt = new Date(nowMs).toISOString();
  const buyers = getBuyersClient();
  const [previous, toggle] = await Promise.all([readManagerRun(), readPilotSwitch()]);
  const mode: ManagerRun["mode"] = settings.mode === "dry" ? "dry" : toggle.paused ? "paused" : opts.mode === "guard" ? "guard" : "on";
  const errors: string[] = [];
  const notes: string[] = [];
  const changes: ManagerChange[] = [];
  const keep = {
    experiments: previous?.experiments ?? [],
    lastNew: Object.fromEntries((previous?.lastNew ?? []).map((m) => [m.id, m.day])) as Record<string, string>,
    marketsTried: previous?.marketsTried ?? [],
  };
  const save = async (today: string) => {
    const run: ManagerRun = {
      _id: RUN_ID,
      _type: "agentRun",
      ranAt,
      mode,
      today,
      changes,
      notes,
      errors,
      experiments: keep.experiments.slice(-120),
      lastNew: Object.entries(keep.lastNew).map(([id, day]) => ({ _key: newKey(), id, day })),
      marketsTried: keep.marketsTried,
      recent: [...changes.filter((c) => c.done), ...(previous?.recent ?? [])].slice(0, 60),
    };
    await buyers.createOrReplace(run);
    return run;
  };

  try {
    const config = metaConfig();
    const pageId = process.env.META_PAGE_ID ?? "";
    if (!config || !pageId) {
      errors.push("Meta isn't connected (META_ADS_ACCESS_TOKEN and the Page), so the ads manager can't see or change the ads.");
      return await save(new Date(nowMs).toISOString().slice(0, 10));
    }
    const [account, pack, share] = await Promise.all([readAccount(config, nowMs), loadFactPack(), realShares(nowMs)]);
    const today = account.today;

    // Real leads: Meta's count, less the share the lead responder rated cold (per ad set).
    const adsetShare = (adsetId: string) =>
      share({ channel: "meta", id: adsetId, level: "adset", name: "", status: "active", dailyBudget: 0, last14: { spend: 0, leads: 0 } });
    const ads = account.ads.map((a) => ({ ...a, last14: { ...a.last14, leads: Math.round(a.last14.leads * adsetShare(a.adsetId) * 100) / 100 } }));
    const results = angleResults(account, share);
    const learnings = learningsOf(results);

    // Bring the record of tests up to date: spend and real leads so far, and when each stopped.
    for (const e of keep.experiments) {
      const life = account.lifetime.get(e.adId);
      if (life) {
        e.spend = Math.round(life.spend * 100) / 100;
        e.leads = Math.round(life.leads * adsetShare(e.adsetId) * 100) / 100;
      }
      const ad = ads.find((a) => a.id === e.adId);
      if (!e.ended && (!ad || ad.status !== "live")) e.ended = today;
    }

    let plan: ManagerPlan = planManager({
      today,
      adsets: account.adsets,
      ads,
      offer: pack.offer ? { endsOn: pack.offer.endsOn, ended: pack.offer.ended } : null,
      lastNew: keep.lastNew,
      angleResults: results,
      markets: ["ghana", "us", "uk", "canada"],
      marketsTried: keep.marketsTried as Market[],
      prices: pack.vat.on ? [...allowedAmounts(pack)] : undefined,
    });
    if (mode === "guard") {
      plan = {
        ...plan,
        pause: plan.pause.filter((p) => p.cause === "offer" || p.cause === "vat"),
        create: plan.create.filter((c) => c.kind !== "challenger"),
        markets: [],
      };
    }
    notes.push(...plan.notes);
    const setName = (id: string) => account.adsets.find((s) => s.id === id)?.name ?? "Ad set";

    if (mode !== "on" && mode !== "guard") {
      for (const c of plan.create) changes.push({ _key: newKey(), day: today, kind: "new ad", adsetId: c.adsetId, adsetName: setName(c.adsetId), name: `${c.angle} ad`, reason: c.reason, done: false });
      for (const p of plan.pause) changes.push({ _key: newKey(), day: today, kind: "pause", adsetId: p.adsetId, adsetName: setName(p.adsetId), adId: p.adId, name: p.name, reason: p.reason, done: false });
      for (const o of plan.ongoing) changes.push({ _key: newKey(), day: today, kind: "keep running", adsetId: o.adsetId, adsetName: o.name, name: o.name, reason: o.reason, done: false });
      for (const m of plan.markets) changes.push({ _key: newKey(), day: today, kind: "new market", adsetId: "", adsetName: MARKET_NAMES[m.market], name: MARKET_NAMES[m.market], reason: m.reason, done: false });
      return await save(today);
    }

    // The things new ads need: the lead form, and the pictures.
    const needsAds = plan.create.length > 0 || plan.markets.length > 0;
    let ctx: Context | null = null;
    if (needsAds) {
      const forms = (await listLeadForms()).filter((f) => f.status === "ACTIVE");
      const form = forms.find((f) => /qualif/i.test(f.name)) ?? forms[0];
      if (!form) errors.push("No active lead form on the Page, so no new ads could be made.");
      else {
        const used = new Map<string, number>();
        for (const e of keep.experiments) used.set(e.picture, (used.get(e.picture) ?? 0) + 1);
        ctx = { config, pack, pageId, formId: form.id, igUserId: process.env.META_IG_USER_ID?.trim() || null, pictures: await pictures(), used, today };
      }
    }

    let blocked: string | null = null;
    const stopIfNotAllowed = (error: unknown) => {
      if (error instanceof MetaError && error.permission) {
        blocked = `Meta doesn't allow the website's key to change ads (${error.message}). The key needs the ads_management and pages_manage_ads permissions.`;
      }
      return error instanceof Error ? error.message : "Meta refused it.";
    };

    // 1. New ads first, so no ad set is left empty.
    for (const item of plan.create) {
      const base = { _key: newKey(), day: today, kind: "new ad" as const, adsetId: item.adsetId, adsetName: setName(item.adsetId), reason: item.reason };
      if (!ctx || blocked) {
        changes.push({ ...base, name: `${item.angle} ad`, done: false, error: blocked ?? "Not made (see the problems above)." });
        continue;
      }
      try {
        const running = ads.filter((a) => a.adsetId === item.adsetId && a.status === "live").map((a) => a.text.slice(0, 300));
        const inSet = new Set(keep.experiments.filter((e) => e.adsetId === item.adsetId && !e.ended).map((e) => e.picture));
        const made = await makeAd(ctx, item, running, learnings, inSet);
        changes.push({ ...base, adId: made.adId, name: made.name, words: made.words, done: true });
        keep.experiments.push({ _key: newKey(), adId: made.adId, adsetId: item.adsetId, market: item.market, angle: item.angle, offerUntil: item.withOffer ? (pack.offer?.endsOn ?? null) : null, picture: made.picture, made: today, ended: null });
        keep.lastNew[item.adsetId] = today;
      } catch (error) {
        changes.push({ ...base, name: `${item.angle} ad`, done: false, error: stopIfNotAllowed(error) });
      }
    }

    // 2. A new market, once.
    for (const m of plan.markets) {
      const base = { _key: newKey(), day: today, kind: "new market" as const, adsetId: "", adsetName: MARKET_NAMES[m.market], name: MARKET_NAMES[m.market], reason: m.reason };
      keep.marketsTried = [...new Set([...keep.marketsTried, m.market])];
      if (!ctx || blocked) {
        changes.push({ ...base, done: false, error: blocked ?? "Not made (see the problems above)." });
        continue;
      }
      try {
        const made = await makeMarket(ctx, m.market, account.campaigns, learnings);
        changes.push({ ...base, adsetId: made.adsetId, done: true, words: made.ads.map((a) => a.words).join(" // ") });
        for (const a of made.ads) {
          keep.experiments.push({ _key: newKey(), adId: a.adId, adsetId: made.adsetId, market: m.market, angle: a.angle, offerUntil: null, picture: a.picture, made: today, ended: null });
        }
        keep.lastNew[made.adsetId] = today;
      } catch (error) {
        // Tried once: a failure leaves anything made switched off (it costs nothing), and is reported.
        changes.push({ ...base, done: false, error: stopIfNotAllowed(error) });
      }
    }

    // 3. Ad sets about to end keep running.
    for (const o of plan.ongoing) {
      const base = { _key: newKey(), day: today, kind: "keep running" as const, adsetId: o.adsetId, adsetName: o.name, name: o.name, reason: o.reason };
      if (blocked) {
        changes.push({ ...base, done: false, error: blocked });
        continue;
      }
      try {
        await metaGraph(config, "POST", o.adsetId, { end_time: "0" });
        changes.push({ ...base, done: true });
        // A campaign with its own end date: take that off too (the ad set alone wouldn't run on).
        const campaignId = account.adsets.find((s) => s.id === o.adsetId)?.campaignId;
        const campaign = account.campaigns.find((c) => c.id === campaignId);
        if (campaign?.stop_time && Date.parse(campaign.stop_time) - nowMs < 4 * 86_400_000) {
          await metaGraph(config, "POST", campaign.id, { stop_time: "0" }).catch((e: Error) =>
            notes.push(`The campaign "${campaign.name}" has its own end date, which couldn't be taken off (${e.message}).`)
          );
        }
      } catch (error) {
        changes.push({ ...base, done: false, error: stopIfNotAllowed(error) });
      }
    }

    // 4. Switching off.
    for (const p of plan.pause) {
      const base = { _key: newKey(), day: today, kind: "pause" as const, adsetId: p.adsetId, adsetName: setName(p.adsetId), adId: p.adId, name: p.name, reason: p.reason };
      if (blocked) {
        changes.push({ ...base, done: false, error: blocked });
        continue;
      }
      try {
        await metaGraph(config, "POST", p.adId, { status: "PAUSED" });
        changes.push({ ...base, done: true });
        const e = keep.experiments.find((x) => x.adId === p.adId);
        if (e && !e.ended) e.ended = today;
      } catch (error) {
        changes.push({ ...base, done: false, error: stopIfNotAllowed(error) });
      }
    }

    if (blocked) errors.push(blocked);
    for (const c of changes) if (!c.done && c.error && c.error !== blocked && !c.error.startsWith("Not made")) errors.push(`${c.name}: ${c.error}`);
    return await save(today);
  } catch (error) {
    console.error("[ads manager] failed:", error);
    errors.push(error instanceof Error ? `The ads manager couldn't run: ${error.message}` : "The ads manager couldn't run.");
    try {
      return await save(new Date(nowMs).toISOString().slice(0, 10));
    } catch {
      return { error: errors.join(" ") };
    }
  }
}
