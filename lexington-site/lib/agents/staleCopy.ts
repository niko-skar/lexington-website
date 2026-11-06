import "server-only";

import { metaConfig } from "@/lib/ads/meta";
import { metaGraph } from "@/lib/ads/metaGraph";
import { metaEnv } from "@/lib/social/meta";

import { staleCopy, type StaleItem } from "./adsHealthCore";
import { loadFactPack } from "./facts";
import { allowedAmounts, soldOutWords } from "./factsCore";

/**
 * OLD WORDS ON INSTAGRAM, FACEBOOK AND THE LEAD FORMS (6 Nov 2026). Customers were quoting old posts' prices back
 * (Niko: "on instagram theres old posts with the old prices that customers are referring to"), and every live Facebook
 * ad opened a lead form still saying "from $86,400 incl. VAT" after the studios sold. No key can archive a post or
 * change a form, so this only finds them, each morning in the ads watchdog: a form that live ads open is to act on
 * (Claude makes a corrected copy and moves the ads onto it); a post is told once, with its link, for Niko to archive
 * in the Instagram app (Facebook Page posts can only be deleted). The words are judged by `staleCopy`, the same rules
 * as the Google adverts' (adsHealthCore.ts).
 */

const GRAPH = "https://graph.facebook.com/v23.0";
/** Posts older than this are left alone. */
const POSTS_DAYS = 180;



interface Page<T> {
  data?: T[];
  paging?: { next?: string };
}

/** Every page of a Graph API list (a few hundred items at most). */
async function everything<T>(path: string, params: Record<string, string>, token: string, max = 400): Promise<T[]> {
  const out: T[] = [];
  let url: string | null = `${GRAPH}/${path}?${new URLSearchParams(params)}`;
  while (url && out.length < max) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const json = (await res.json()) as Page<T> & { error?: { message?: string } };
    if (json.error) throw new Error(json.error.message ?? "Meta refused it");
    out.push(...(json.data ?? []));
    url = json.paging?.next ?? null;
  }
  return out;
}

function shift(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The posts and the live ads' lead forms whose words are out of date. Never throws. */
export type { StaleItem };

export async function findStaleCopy(today: string): Promise<{ items: StaleItem[]; error: string | null }> {
  let env: ReturnType<typeof metaEnv>;
  try {
    env = metaEnv();
  } catch {
    return { items: [], error: "The Facebook Page key (META_PAGE_TOKEN) isn't set, so the posts couldn't be read." };
  }
  const items: StaleItem[] = [];
  const errors: string[] = [];
  let facts: { prices: Set<number>; soldOut: string[]; today: string };
  try {
    const pack = await loadFactPack();
    facts = { prices: allowedAmounts(pack), soldOut: soldOutWords(pack), today };
  } catch (error) {
    return { items: [], error: `The website's prices couldn't be read: ${error instanceof Error ? error.message : "unknown"}` };
  }
  const since = shift(today, -POSTS_DAYS);
  const firstLine = (text: string) => text.split("\n")[0].slice(0, 90);

  if (env.igUserId) {
    try {
      const media = await everything<{ id: string; caption?: string; timestamp?: string; permalink?: string }>(`${env.igUserId}/media`, { fields: "id,caption,timestamp,permalink", limit: "100" }, env.pageToken);
      for (const m of media) {
        const date = (m.timestamp ?? "").slice(0, 10);
        if (date < since) continue;
        const issues = staleCopy(m.caption ?? "", facts);
        if (issues.length) items.push({ id: m.id, where: "Instagram", date, link: m.permalink ?? "", name: firstLine(m.caption ?? ""), issues, liveAds: 0 });
      }
    } catch (error) {
      errors.push(`Instagram: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  try {
    const posts = await everything<{ id: string; message?: string; created_time?: string; permalink_url?: string }>(`${env.pageId}/posts`, { fields: "id,message,created_time,permalink_url", limit: "100" }, env.pageToken);
    for (const p of posts) {
      const date = (p.created_time ?? "").slice(0, 10);
      if (date < since) continue;
      const issues = staleCopy(p.message ?? "", facts);
      if (issues.length) items.push({ id: p.id, where: "Facebook", date, link: p.permalink_url ?? "", name: firstLine(p.message ?? ""), issues, liveAds: 0 });
    }
  } catch (error) {
    errors.push(`Facebook posts: ${error instanceof Error ? error.message : "unknown"}`);
  }

  // The lead forms the live ads open: the form's first screen is what every person who taps an ad reads.
  const config = metaConfig();
  if (config) {
    try {
      type AdRow = { creative?: { object_story_spec?: { link_data?: { call_to_action?: { value?: { lead_gen_form_id?: string } } } } } };
      const ads = await metaGraph<{ data?: AdRow[] }>(config, "GET", `act_${config.accountId}/ads`, {
        fields: "creative{object_story_spec{link_data{call_to_action}}}",
        effective_status: JSON.stringify(["ACTIVE", "IN_PROCESS", "PENDING_REVIEW"]),
        limit: "300",
      });
      const forms = new Map<string, number>();
      for (const a of ads.data ?? []) {
        const form = a.creative?.object_story_spec?.link_data?.call_to_action?.value?.lead_gen_form_id;
        if (form) forms.set(form, (forms.get(form) ?? 0) + 1);
      }
      for (const [id, liveAds] of forms) {
        const url = `${GRAPH}/${id}?${new URLSearchParams({ fields: "name,created_time,context_card{title,content}" })}`;
        const form = (await (await fetch(url, { headers: { Authorization: `Bearer ${env.pageToken}` }, cache: "no-store" })).json()) as {
          name?: string;
          created_time?: string;
          context_card?: { title?: string; content?: string[] };
          error?: { message?: string };
        };
        if (form.error) {
          errors.push(`lead form ${id}: ${form.error.message ?? "unreadable"}`);
          continue;
        }
        const words = [form.context_card?.title ?? "", ...(form.context_card?.content ?? [])].join(" | ");
        const issues = staleCopy(words, facts);
        if (issues.length) items.push({ id, where: "Lead form", date: (form.created_time ?? "").slice(0, 10), link: "", name: form.name ?? id, issues, liveAds });
      }
    } catch (error) {
      errors.push(`lead forms: ${error instanceof Error ? error.message : "unknown"}`);
    }
  } else {
    errors.push("the ad account key (META_ADS_ACCESS_TOKEN) isn't set, so the live ads' lead forms weren't checked");
  }
  return { items, error: errors.length ? errors.join(" | ") : null };
}
