import "server-only";

import { randomUUID } from "node:crypto";

import { cookies, headers } from "next/headers";
import { after } from "next/server";

import { getBuyersClient } from "@/lib/sanity/buyersClient";

import { buildCapiEvent, clientIp, type MetaEventName, type MetaPerson, type MetaWebsiteEvent } from "./conversionsCore";

/**
 * Sends the website's own report of an enquiry, price-list request, visit booking or reservation request to Meta (see
 * conversionsCore.ts). Only production sends real events; anywhere else nothing goes unless META_CAPI_TEST_CODE is set
 * (Events Manager > Test events), and then only as a test.
 *
 * The key: META_CAPI_TOKEN (a Conversions API key made in Events Manager, which doesn't run out), else the ads key
 * META_ADS_ACCESS_TOKEN (his own key with ads_management, which does run out). The last answer from Meta is kept in one
 * small private document (`agentState.metaCapi`) and shown on the Connect page.
 */

export const META_PIXEL_ID = process.env.META_PIXEL_ID?.trim() || "821227914351581";
const STATE_ID = process.env.VERCEL_ENV === "production" ? "agentState.metaCapi" : "agentState.metaCapi-dev";

function graphVersion() {
  const v = process.env.META_GRAPH_VERSION?.trim() ?? "";
  return /^v\d+\.\d+$/.test(v) ? v : "v23.0";
}

// A stand-in server (META_GRAPH_BASE) is only ever used for testing; production always posts to Meta.
const graphBase = () =>
  process.env.VERCEL_ENV !== "production" && process.env.META_GRAPH_BASE
    ? process.env.META_GRAPH_BASE.replace(/\/+$/, "")
    : "https://graph.facebook.com";

export function capiKey(): { token: string; which: "META_CAPI_TOKEN" | "META_ADS_ACCESS_TOKEN" } | null {
  const own = process.env.META_CAPI_TOKEN?.trim();
  if (own) return { token: own, which: "META_CAPI_TOKEN" };
  const ads = process.env.META_ADS_ACCESS_TOKEN?.trim();
  return ads ? { token: ads, which: "META_ADS_ACCESS_TOKEN" } : null;
}

/** A new event for a form that has just gone through; its id goes to the browser too. */
export function newMetaEvent(name: MetaEventName, contentName: string, unit?: string): MetaWebsiteEvent {
  return { name, id: randomUUID(), contentName, ...(unit ? { unit } : {}) };
}

export type CapiAnswer = { ok: true; received: number; trace?: string } | { ok: false; error: string };

/** One POST to Meta. Never throws. */
export async function postToMeta(events: unknown[], testCode?: string): Promise<CapiAnswer> {
  const key = capiKey();
  if (!key) return { ok: false, error: "No Meta key is set (META_CAPI_TOKEN or META_ADS_ACCESS_TOKEN)." };
  try {
    const res = await fetch(`${graphBase()}/${graphVersion()}/${META_PIXEL_ID}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: events, access_token: key.token, ...(testCode ? { test_event_code: testCode } : {}) }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { events_received?: number; fbtrace_id?: string; error?: { message?: string; code?: number } };
    if (!res.ok || json.error) return { ok: false, error: `${json.error?.message ?? `HTTP ${res.status}`}${json.error?.code ? ` (code ${json.error.code})` : ""}` };
    return { ok: true, received: json.events_received ?? 0, trace: json.fbtrace_id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Meta could not be reached." };
  }
}

async function remember(event: MetaWebsiteEvent, answer: CapiAnswer, which: string) {
  try {
    const at = new Date().toISOString();
    const buyers = getBuyersClient();
    await buyers.createIfNotExists({ _id: STATE_ID, _type: "agentState" });
    await buyers
      .patch(STATE_ID)
      .set({
        lastAt: at,
        lastEvent: `${event.name}: ${event.contentName}`,
        lastKey: which,
        lastOk: answer.ok,
        ...(answer.ok ? { lastOkAt: at } : { lastError: answer.error.slice(0, 300), lastErrorAt: at }),
      })
      .setIfMissing({ sent: 0 })
      .inc({ sent: answer.ok ? 1 : 0 })
      .commit();
  } catch (error) {
    console.error("[meta events] could not note the result:", error instanceof Error ? error.message : error);
  }
}

/**
 * Reports one event from a form that has just gone through. The request's details (address, browser, Meta's cookies,
 * the page) are read now; the call to Meta happens after the visitor has their answer. Never throws, never slows the form.
 */
export async function reportToMeta(event: MetaWebsiteEvent, person: MetaPerson): Promise<void> {
  try {
    const key = capiKey();
    const testCode = process.env.META_CAPI_TEST_CODE?.trim() || undefined;
    if (!key || (process.env.VERCEL_ENV !== "production" && !testCode)) return;
    const h = await headers();
    const jar = await cookies();
    const body = buildCapiEvent(event, person, {
      ip: clientIp(h.get("x-real-ip"), h.get("x-forwarded-for")),
      userAgent: h.get("user-agent") ?? undefined,
      fbp: jar.get("_fbp")?.value,
      fbc: jar.get("_fbc")?.value,
      url: h.get("referer") ?? undefined,
    });
    after(async () => {
      const answer = await postToMeta([body], testCode);
      if (!answer.ok) console.error(`[meta events] ${event.name} not accepted: ${answer.error}`);
      await remember(event, answer, key.which);
    });
  } catch (error) {
    console.error("[meta events] could not report:", error instanceof Error ? error.message : error);
  }
}

export interface MetaCapiState {
  lastAt?: string;
  lastEvent?: string;
  lastKey?: string;
  lastOk?: boolean;
  lastOkAt?: string;
  lastError?: string;
  lastErrorAt?: string;
  sent?: number;
}

export async function readMetaCapiState(): Promise<MetaCapiState | null> {
  try {
    return await getBuyersClient().fetch<MetaCapiState | null>(`*[_id == $id][0]{ lastAt, lastEvent, lastKey, lastOk, lastOkAt, lastError, lastErrorAt, sent }`, { id: STATE_ID });
  } catch {
    return null;
  }
}
