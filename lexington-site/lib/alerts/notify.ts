import { createClient, type SanityClient } from "@sanity/client";
import { randomBytes } from "node:crypto";
import { sendNotification } from "web-push";

import { ALERT_KINDS, MAX_LINE, MAX_LINES, MAX_LINKS, MAX_TITLE, type AlertKind, type AlertLink } from "./shared";

// Saving an alert for Niko and buzzing his phone. Kept apart from ./server (the reading side, which
// is marked server-only) because the daily posts also run from a laptop script (npm run
// social:post), where a server-only module can't load.
//
// Alerts live in the PRIVATE buyers dataset (they name prospects and buyers). Live ones are
// "alert-live-<12 hex>"; a preview build or a laptop writes "alert-dev-..." so a test never shows
// up on Niko's phone. Phones that get the alerts are "pushsub-live-<hash of the phone's address>",
// each with its owner: "office", or a site login's account id (the foreman gets a buzz when the
// office adds a job, 27 Oct 2026). Phones saved before owners existed are the office's.
export const LIVE = process.env.VERCEL_ENV === "production";
export const PREFIX = LIVE ? "alert-live-" : "alert-dev-";
export const SUB_PREFIX = LIVE ? "pushsub-live-" : "pushsub-dev-";
export const OFFICE = "office";
/** Older alerts go: the list is for what's happening now; the CRM keeps the history. */
const KEEP = 400;

let cached: SanityClient | null = null;
export function alertsClient(): SanityClient {
  if (cached) return cached;
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
  const dataset = process.env.NEXT_PUBLIC_SANITY_BUYERS_DATASET;
  const token = process.env.SANITY_BUYERS_API_TOKEN;
  if (!projectId || !dataset || !token) {
    throw new Error("Missing NEXT_PUBLIC_SANITY_PROJECT_ID / NEXT_PUBLIC_SANITY_BUYERS_DATASET / SANITY_BUYERS_API_TOKEN.");
  }
  cached = createClient({ projectId, dataset, token, apiVersion: "2024-06-01", useCdn: false });
  return cached;
}

export interface NewAlert {
  kind: AlertKind;
  title: string;
  lines?: string[];
  links?: AlertLink[];
  /** Buzz the phone too: something Niko has to act on. */
  urgent?: boolean;
  /** Phone alerts with the same tag replace each other on the lock screen (one per chat). */
  tag?: string;
  /** The page of the app a tap on the phone alert opens (a job), instead of the alert itself. */
  open?: string;
  /** A photo for the phone alert (Android shows it; an iPhone doesn't). */
  image?: string;
}

export const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
export const newAlertId = () => PREFIX + randomBytes(6).toString("hex");
const newKey = () => randomBytes(6).toString("hex");

/**
 * Saves an alert for Niko and, when it needs him, buzzes his phone. Never throws: answers false
 * when the alert could not be saved, so a caller with nothing else to fall back on can still email.
 */
export async function notifyOwner(alert: NewAlert): Promise<boolean> {
  const id = newAlertId();
  const kind: AlertKind = ALERT_KINDS.includes(alert.kind) ? alert.kind : "test";
  const title = clip(alert.title.trim() || "The Lexington", MAX_TITLE);
  const lines = (alert.lines ?? []).map((l) => clip(String(l).trim(), MAX_LINE)).filter(Boolean).slice(0, MAX_LINES);
  const links = (alert.links ?? [])
    .filter((l) => l && l.url && /^(https:\/\/|\/)/.test(l.url))
    .slice(0, MAX_LINKS)
    .map((l) => ({ _key: newKey(), label: clip(l.label, 60), url: l.url }));
  try {
    await alertsClient().create({
      _id: id,
      _type: "ownerAlert",
      kind,
      title,
      lines,
      links,
      urgent: alert.urgent === true,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[alerts] could not save an alert:", error instanceof Error ? error.message : error, "|", title);
    return false;
  }

  if (alert.urgent) {
    try {
      // A tap on a job's alert opens the job, and says which alert it was so that one counts as seen.
      const open = alert.open?.startsWith("/todo") ? `${alert.open}${alert.open.includes("?") ? "&" : "?"}alert=${id}` : null;
      await pushToPhones({
        title,
        body: clip(lines.slice(0, 3).join("\n") || "Open the app to see it.", 240),
        url: open ?? `/todo/alerts?open=${id}`,
        tag: alert.tag ? clip(alert.tag, 60) : id,
        unread: await unreadCount(),
        ...(alert.image ? { image: alert.image } : {}),
      });
    } catch (error) {
      console.error("[alerts] phone alert failed:", error instanceof Error ? error.message : error);
    }
  }
  await prune().catch(() => {});
  return true;
}

async function prune(): Promise<void> {
  const client = alertsClient();
  const old = await client.fetch<string[]>(
    `*[_type == "ownerAlert" && string::startsWith(_id, $prefix)] | order(createdAt desc)[${KEEP}...${KEEP + 100}]._id`,
    { prefix: PREFIX }
  );
  if (!old.length) return;
  const tx = client.transaction();
  for (const id of old) tx.delete(id);
  await tx.commit();
}

export async function unreadCount(): Promise<number> {
  return alertsClient().fetch<number>(`count(*[_type == "ownerAlert" && string::startsWith(_id, $prefix) && !defined(readAt)])`, {
    prefix: PREFIX,
  });
}

/* ---------- phone alerts (Web Push: the home-screen app on his iPhone, the foreman's Android) ---------- */

/** The website's own key pair for phone alerts. Without it alerts still land in the app, they just don't buzz. */
export function vapid(): { publicKey: string; privateKey: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  return publicKey && privateKey ? { publicKey, privateKey } : null;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Where a tap opens (always inside the app). */
  url: string;
  tag: string;
  /** For the number on the app's icon (the office's unread alerts). */
  unread?: number;
  /** A photo to show with it (https://cdn.sanity.io only: the phone's helper refuses others). */
  image?: string;
}

/** Sends one phone alert to every office phone that asked for them (or just one). */
export async function pushToPhones(payload: PushPayload, only?: string): Promise<{ sent: number; failed: number }> {
  return pushToPeople([OFFICE], payload, only);
}

/**
 * Sends one phone alert to the phones of these people ("office", site login ids), or to just one
 * of their phones. A phone that has gone away is forgotten.
 */
export async function pushToPeople(owners: string[], payload: PushPayload, only?: string): Promise<{ sent: number; failed: number }> {
  const keys = vapid();
  if (!keys || owners.length === 0) return { sent: 0, failed: 0 };
  const client = alertsClient();
  const subs = await client.fetch<Array<{ _id: string; endpoint: string; p256dh: string; auth: string }>>(
    `*[_type == "pushSubscription" && string::startsWith(_id, $prefix) && coalesce(owner, $office) in $owners && ($only == "" || _id == $only)]{ _id, endpoint, p256dh, auth }`,
    { prefix: SUB_PREFIX, office: OFFICE, owners, only: only ?? "" }
  );
  let sent = 0;
  let failed = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), {
          vapidDetails: { subject: "mailto:sales@lexington.com.gh", publicKey: keys.publicKey, privateKey: keys.privateKey },
          TTL: 24 * 3600,
          urgency: "high",
          timeout: 8000,
        });
        sent++;
      } catch (error) {
        failed++;
        const status = (error as { statusCode?: number }).statusCode;
        // 404 / 410: the phone turned alerts off or the app was removed. Forget it.
        if (status === 404 || status === 410) await client.delete(s._id).catch(() => {});
        else console.error("[alerts] push to a phone failed:", status ?? "", error instanceof Error ? error.message : error);
      }
    })
  );
  return { sent, failed };
}
