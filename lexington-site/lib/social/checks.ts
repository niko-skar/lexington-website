import { createClient } from "@sanity/client";

import { SITE_URL } from "@/lib/seo";
import type { SocialCheck } from "./types";

// Every number in a post was read from the website's data when the pictures were drawn. On the morning it goes out the
// same facts are read again; if one has changed (a price, a sold unit, an offer that ended) the post is held back.

const sanity = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || "2p1ef4hj",
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET || "production",
  apiVersion: "2024-06-01",
  useCdn: false,
  perspective: "published",
});

// Sanity returns object keys alphabetically; compare without caring about order.
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, canon((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const brief = (v: unknown) => JSON.stringify(v).slice(0, 160);

const pages = new Map<string, string>();
async function pageText(path: string): Promise<string> {
  const hit = pages.get(path);
  if (hit !== undefined) return hit;
  const res = await fetch(SITE_URL + path, { headers: { "cache-control": "no-cache" }, cache: "no-store" });
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  const text = (await res.text()).replace(/&#x27;|&rsquo;|&#39;/g, "'").replace(/&amp;/g, "&");
  pages.set(path, text);
  return text;
}

/** Returns what is wrong; an empty list means every fact still holds. */
export async function runChecks(checks: SocialCheck[]): Promise<string[]> {
  pages.clear();
  const failed: string[] = [];
  for (const c of checks) {
    try {
      if (c.page) {
        const t = await pageText(c.page);
        if (c.includes && !t.includes(c.includes)) failed.push(`${c.note}: not found on ${c.page}`);
        continue;
      }
      const v = await sanity.fetch(c.q as string);
      if ("equals" in c && !same(v, c.equals)) failed.push(`${c.note}: now ${brief(v)}, expected ${brief(c.equals)}`);
      else if (c.includes !== undefined && !String(v ?? "").includes(c.includes)) failed.push(`${c.note}: "${c.includes}" is no longer there`);
      else if (c.includesAll && !c.includesAll.every((x) => Array.isArray(v) && v.includes(x))) failed.push(`${c.note}: now ${brief(v)}`);
    } catch (e) {
      failed.push(`${c.note}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return failed;
}
