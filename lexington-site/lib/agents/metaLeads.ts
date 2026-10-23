import "server-only";

import { saveMetaLead, type MetaFormLead } from "@/lib/crmIntake";
import { getBuyersClient } from "@/lib/sanity/buyersClient";

/**
 * FACEBOOK / INSTAGRAM LEAD FORMS INTO THE CRM. Every ten minutes the Page's lead
 * forms are asked for entries since the last look; each new one becomes a prospect
 * (or joins the person already there by email or phone), with a "Reply to ..." step
 * and a suggested first reply (the lead responder does that part).
 *
 * WHAT IS NEEDED. A token that may read leads (`leads_retrieval`, plus
 * `pages_manage_ads`, `pages_manage_metadata`, `pages_read_engagement` and
 * `pages_show_list`), as META_LEADS_TOKEN: best a system user's token from Business
 * settings (it never expires and isn't tied to anyone's password), which is swapped for
 * the Page's token on each look. The daily-posts token (META_PAGE_TOKEN) is tried when
 * it is not set, but it was made without those permissions. Until then each look just
 * records "not allowed" and the Connect page and the daily ads check say so.
 *
 * What has been seen lives in one small private document (`agentState.metaLeads`).
 */

// A test copy or a preview keeps its own record, so it can never make the live site skip a lead.
const STATE_ID = process.env.VERCEL_ENV === "production" ? "agentState.metaLeads" : "agentState.metaLeads-dev";
const FIRST_LOOK_DAYS = 3;
const KEEP_SEEN = 400;

interface MetaLeadsState {
  _id: string;
  _type: "agentState";
  /** The newest entry time seen (ISO). */
  since?: string;
  seen?: string[];
  lastRunAt?: string;
  lastOkAt?: string;
  lastError?: string | null;
  forms?: number;
}

export interface MetaLeadsResult {
  ok: boolean;
  error?: string;
  forms: number;
  added: Array<{ id: string; name: string; isNew: boolean }>;
}

function graphBase(): string {
  const version = /^v\d+\.\d+$/.test(process.env.META_GRAPH_VERSION ?? "") ? process.env.META_GRAPH_VERSION : "v23.0";
  // A stand-in server is only ever used for testing; production always asks Meta.
  const base =
    process.env.VERCEL_ENV !== "production" && process.env.META_GRAPH_BASE
      ? process.env.META_GRAPH_BASE.replace(/\/+$/, "")
      : "https://graph.facebook.com";
  return `${base}/${version}`;
}

function leadsToken(): string | null {
  return process.env.META_LEADS_TOKEN?.trim() || process.env.META_PAGE_TOKEN?.trim() || null;
}

export function metaLeadsConfigured(): boolean {
  return Boolean(process.env.META_PAGE_ID && leadsToken());
}

async function graphGet<T>(path: string, params: Record<string, string>, token: string): Promise<T> {
  const url = `${graphBase()}/${path}?${new URLSearchParams(params)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as ({ error?: { message?: string; code?: number } } & T) | null;
  if (!response.ok || body?.error) {
    const message = body?.error?.message ?? `Meta answered ${response.status}`;
    const code = body?.error?.code;
    if (code === 190) throw new Error(`Meta no longer accepts the token (${message})`);
    if (code === 10 || code === 200 || code === 100 || /permission/i.test(message)) {
      throw new Error(`The token may not read lead forms yet (${message})`);
    }
    throw new Error(message);
  }
  return body as T;
}

interface GraphLead {
  id: string;
  created_time: string;
  field_data?: Array<{ name: string; values?: string[] }>;
  ad_name?: string;
  campaign_name?: string;
  campaign_id?: string;
  adset_id?: string;
  ad_id?: string;
  form_id?: string;
  is_organic?: boolean;
}

/** "what's_your_budget?" -> "What's your budget?" */
export function questionWords(key: string): string {
  const words = key.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A form answer as Meta stores it ("$150,000_to_$300,000", "greater_accra") in plain words. */
export function answerWords(value: string): string {
  return value.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

// What Meta adds to every entry but nobody was asked: a link to the chat, whether the phone was checked.
const NOT_QUESTIONS = new Set(["inbox_url", "phone_number_verified", "is_organic", "platform"]);

/** One lead form entry in the CRM's words. Pure. */
export function readLead(lead: GraphLead, formName: string): MetaFormLead {
  const fields = new Map((lead.field_data ?? []).map((f) => [f.name.toLowerCase(), (f.values ?? []).join(", ").trim()]));
  const take = (...keys: string[]) => {
    for (const key of keys) {
      const value = fields.get(key);
      if (value) {
        fields.delete(key);
        return value;
      }
    }
    return "";
  };
  const first = take("first_name");
  const last = take("last_name");
  const name = take("full_name", "name") || [first, last].filter(Boolean).join(" ");
  const email = take("email", "work_email");
  const phone = take("phone_number", "phone", "whatsapp_number");
  const answers = [...fields.entries()]
    .filter(([k, v]) => v && !NOT_QUESTIONS.has(k))
    .map(([k, v]) => ({ question: questionWords(k), answer: answerWords(v) }));
  return {
    metaLeadId: lead.id,
    createdAt: lead.created_time,
    name,
    email: email.includes("@") ? email : "",
    phone,
    formName,
    adName: lead.ad_name ?? "",
    campaignId: lead.campaign_id ?? "",
    adsetId: lead.adset_id ?? "",
    adId: lead.ad_id ?? "",
    answers,
  };
}

async function readState(): Promise<MetaLeadsState> {
  const doc = await getBuyersClient().getDocument<MetaLeadsState>(STATE_ID);
  return doc ?? { _id: STATE_ID, _type: "agentState" };
}

export async function readMetaLeadsState(): Promise<MetaLeadsState | null> {
  try {
    return await getBuyersClient().getDocument<MetaLeadsState>(STATE_ID) ?? null;
  } catch {
    return null;
  }
}

/**
 * The Page's own token. Lead forms are read with a Page token: one set as META_LEADS_TOKEN
 * is used as it is, and a system user's token (the kind made in Business settings, which
 * never expires) is swapped for the Page token it is allowed to fetch.
 */
async function pageTokenFrom(pageId: string, token: string): Promise<{ token: string; problem?: string }> {
  try {
    const page = await graphGet<{ access_token?: string }>(pageId, { fields: "access_token" }, token);
    return page.access_token ? { token: page.access_token } : { token, problem: "Facebook gave no Page key back" };
  } catch (error) {
    return { token, problem: error instanceof Error ? error.message : "the swap failed" };
  }
}

/**
 * Prospects from lead forms saved before the campaign and ad set were recorded: up to ten a
 * look, from the last 30 days. An entry Meta gives no campaign for (not from an advert) gets
 * an empty one, so it isn't asked about again; one that can't be read is tried next time.
 */
async function fillCampaigns(token: string): Promise<void> {
  const buyers = getBuyersClient();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const missing = await buyers.fetch<Array<{ _id: string; metaLeadId: string }>>(
    `*[_type == "lead" && defined(metaLeadId) && !defined(metaCampaignId) && _createdAt > $since] | order(_createdAt desc)[0...10]{ _id, metaLeadId }`,
    { since }
  );
  for (const lead of missing) {
    const found = await graphGet<{ campaign_id?: string; adset_id?: string; ad_id?: string }>(
      lead.metaLeadId,
      { fields: "campaign_id,adset_id,ad_id" },
      token
    ).catch(() => null);
    if (!found) continue;
    await buyers
      .patch(lead._id)
      .set({
        metaCampaignId: found.campaign_id ?? "",
        ...(found.adset_id && { metaAdsetId: found.adset_id }),
        ...(found.ad_id && { metaAdId: found.ad_id }),
      })
      .commit();
  }
}

let pageKeyCache: { pageId: string; token: string; until: number } | null = null;

/**
 * The Page's own key, for the chat agent to answer messages with (kept ten minutes, so a busy
 * chat doesn't swap keys on every message). Null when the Page or its key isn't set.
 */
export async function pageAccess(): Promise<{ pageId: string; token: string; base: string } | null> {
  const pageId = process.env.META_PAGE_ID;
  const given = leadsToken();
  if (!pageId || !given) return null;
  if (pageKeyCache && pageKeyCache.pageId === pageId && pageKeyCache.until > Date.now()) {
    return { pageId, token: pageKeyCache.token, base: graphBase() };
  }
  const swap = await pageTokenFrom(pageId, given);
  if (!swap.problem) pageKeyCache = { pageId, token: swap.token, until: Date.now() + 10 * 60_000 };
  return { pageId, token: swap.token, base: graphBase() };
}

/** The Page's lead forms, newest first: the ads manager attaches its new ads to one of them. */
export async function listLeadForms(): Promise<Array<{ id: string; name: string; status: string; created: string }>> {
  const pageId = process.env.META_PAGE_ID;
  const given = leadsToken();
  if (!pageId || !given) throw new Error("No Facebook Page token is set.");
  const { token } = await pageTokenFrom(pageId, given);
  const forms = await graphGet<{ data?: Array<{ id: string; name?: string; status?: string; created_time?: string }> }>(
    `${pageId}/leadgen_forms`,
    { fields: "id,name,status,created_time", limit: "100" },
    token
  );
  return (forms.data ?? [])
    .map((f) => ({ id: f.id, name: f.name ?? "", status: f.status ?? "ACTIVE", created: f.created_time ?? "" }))
    .sort((a, b) => b.created.localeCompare(a.created));
}

/** One look at the lead forms. Never throws. */
export async function pollMetaLeads(nowMs = Date.now()): Promise<MetaLeadsResult> {
  const pageId = process.env.META_PAGE_ID;
  const given = leadsToken();
  if (!pageId || !given) return { ok: false, error: "No Facebook Page token is set.", forms: 0, added: [] };
  const swap = await pageTokenFrom(pageId, given);
  const token = swap.token;

  const buyers = getBuyersClient();
  const state = await readState();
  const now = new Date(nowMs).toISOString();
  const since = state.since ?? new Date(nowMs - FIRST_LOOK_DAYS * 86_400_000).toISOString();
  // An hour of overlap: entries can show up a little after their time; the seen-list stops repeats.
  const fromUnix = Math.floor(new Date(since).getTime() / 1000) - 3600;
  const seen = new Set(state.seen ?? []);

  const added: MetaLeadsResult["added"] = [];
  let newest = since;
  try {
    const forms = await graphGet<{ data?: Array<{ id: string; name?: string; status?: string }> }>(
      `${pageId}/leadgen_forms`,
      { fields: "id,name,status", limit: "100" },
      token
    );
    const active = (forms.data ?? []).filter((f) => !f.status || f.status === "ACTIVE");

    for (const form of active) {
      const leads = await graphGet<{ data?: GraphLead[] }>(
        `${form.id}/leads`,
        {
          fields: "id,created_time,field_data,ad_name,campaign_name,campaign_id,adset_id,ad_id,form_id,is_organic",
          filtering: JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: fromUnix }]),
          limit: "100",
        },
        token
      );
      const fresh = (leads.data ?? []).filter((l) => !seen.has(l.id)).sort((a, b) => a.created_time.localeCompare(b.created_time));
      for (const lead of fresh) {
        const entry = readLead(lead, form.name ?? "");
        const saved = await saveMetaLead(entry);
        // Not saved: stop here, so the next look starts from this entry again.
        if (saved === null) throw new Error(`Could not save ${entry.name || "a lead"} to the CRM; trying again next time.`);
        seen.add(lead.id);
        if (saved !== "exists") added.push({ id: saved.id, name: entry.name || "Facebook lead", isNew: saved.isNew });
        const at = new Date(lead.created_time).toISOString();
        if (at > newest) newest = at;
      }
    }

    // Entries saved before their campaign was recorded get it now (the ads autopilot counts real leads per campaign).
    await fillCampaigns(token).catch(() => undefined);

    await buyers.createOrReplace({
      ...state,
      since: newest,
      seen: [...seen].slice(-KEEP_SEEN),
      lastRunAt: now,
      lastOkAt: now,
      lastError: null,
      forms: active.length,
    });
    return { ok: true, forms: active.length, added };
  } catch (error) {
    let message = error instanceof Error ? error.message : "Meta could not be reached.";
    // A user's key that could not be swapped for the Page's: say why the swap failed, which is the real cause.
    if (/page access token/i.test(message) && swap.problem) {
      message = `The saved key is a personal key, and Facebook would not swap it for the Page's key (${swap.problem})`;
    }
    // Whatever was saved before the problem is remembered as seen; the next look starts
    // from the same point as this one, so nothing after the problem is skipped.
    await buyers
      .createOrReplace({ ...state, since, seen: [...seen].slice(-KEEP_SEEN), lastRunAt: now, lastError: message })
      .catch(() => undefined);
    return { ok: false, error: message, forms: 0, added };
  }
}
