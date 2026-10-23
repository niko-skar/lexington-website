import "server-only";
import { createHash } from "node:crypto";

import { alertsClient, clip, LIVE, newAlertId, PREFIX, pushToPhones, SUB_PREFIX, unreadCount, vapid } from "./notify";
import type { AlertsData, OwnerAlert, PushState } from "./shared";

// The reading side of Niko's alerts (the office only: the API checks who asks), and the phones
// that get them. Saving one is notifyOwner() in ./notify.
export { notifyOwner, unreadCount } from "./notify";

const ID_RE = LIVE ? /^alert-live-[a-f0-9]{12}$/ : /^alert-dev-[a-f0-9]{12}$/;
const SUB_ID_RE = LIVE ? /^pushsub-live-[a-f0-9]{24}$/ : /^pushsub-dev-[a-f0-9]{24}$/;
const SHOWN = 120;

const FIELDS = `{ "id": _id, kind, title, "lines": coalesce(lines, []), "links": coalesce(links[]{ label, url }, []), "urgent": coalesce(urgent, false), createdAt, "readAt": coalesce(readAt, null) }`;

export async function listAlerts(): Promise<AlertsData> {
  const [alerts, unread, push] = await Promise.all([
    alertsClient().fetch<OwnerAlert[]>(
      `*[_type == "ownerAlert" && string::startsWith(_id, $prefix)] | order(createdAt desc)[0...${SHOWN}] ${FIELDS}`,
      { prefix: PREFIX }
    ),
    unreadCount(),
    pushState(),
  ]);
  return { alerts, unread, push };
}

/** Marks alerts read: all of them, or the ones named. Answers how many it looked at. */
export async function markRead(which: "all" | string[]): Promise<number> {
  const client = alertsClient();
  const ids =
    which === "all"
      ? await client.fetch<string[]>(`*[_type == "ownerAlert" && string::startsWith(_id, $prefix) && !defined(readAt)]._id`, { prefix: PREFIX })
      : which.filter((id) => ID_RE.test(id));
  if (!ids.length) return 0;
  const at = new Date().toISOString();
  const tx = client.transaction();
  for (const id of ids) tx.patch(id, (p) => p.setIfMissing({ readAt: at }));
  await tx.commit();
  return ids.length;
}

/* ---------- the phones that get them ---------- */

export async function pushState(): Promise<PushState> {
  const keys = vapid();
  const subs = await alertsClient().fetch<Array<{ _id: string; name?: string; createdAt?: string }>>(
    `*[_type == "pushSubscription" && string::startsWith(_id, $prefix)] | order(createdAt asc){ _id, name, createdAt }`,
    { prefix: SUB_PREFIX }
  );
  return {
    configured: Boolean(keys),
    publicKey: keys?.publicKey ?? null,
    devices: subs.map((s) => ({ id: s._id, name: s.name || "Phone", since: s.createdAt ?? "" })),
  };
}

const subId = (endpoint: string) => SUB_PREFIX + createHash("sha256").update(endpoint).digest("hex").slice(0, 24);

// Only the push services browsers really use (Apple, Google, Mozilla, Microsoft). A laptop test may
// point at a stand-in on this machine; the live site never can.
const PUSH_HOSTS = [/(^|\.)push\.apple\.com$/, /^fcm\.googleapis\.com$/, /\.googleapis\.com$/, /\.mozilla\.com$/, /\.mozaws\.net$/, /\.notify\.windows\.com$/];

export function cleanSubscription(value: unknown): { endpoint: string; p256dh: string; auth: string } | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = typeof v.endpoint === "string" ? v.endpoint.trim() : "";
  const p256dh = typeof v.keys?.p256dh === "string" ? v.keys.p256dh.trim() : "";
  const auth = typeof v.keys?.auth === "string" ? v.keys.auth.trim() : "";
  if (!endpoint || endpoint.length > 1000 || !/^[A-Za-z0-9_-]{80,100}={0,2}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}={0,2}$/.test(auth)) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  const local = !LIVE && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (!local && (url.protocol !== "https:" || !PUSH_HOSTS.some((re) => re.test(url.hostname)))) return null;
  return { endpoint, p256dh, auth };
}

/** This phone gets the alerts from now on (asked again on every app start: the same phone is one entry). */
export async function savePushSubscription(sub: { endpoint: string; p256dh: string; auth: string }, name: string): Promise<string> {
  const id = subId(sub.endpoint);
  const client = alertsClient();
  const since = await client.fetch<string | null>(`*[_id == $id][0].createdAt`, { id });
  await client.createOrReplace({
    _id: id,
    _type: "pushSubscription",
    endpoint: sub.endpoint,
    p256dh: sub.p256dh,
    auth: sub.auth,
    name: clip(name.trim() || "Phone", 40),
    createdAt: since ?? new Date().toISOString(),
  });
  return id;
}

export async function removePushSubscription(endpointOrId: string): Promise<void> {
  const id = SUB_ID_RE.test(endpointOrId) ? endpointOrId : subId(endpointOrId);
  await alertsClient().delete(id);
}

/** "Send a test": a phone alert to the phone that asked (it also lands in the list). */
export async function sendTest(subscriptionId: string): Promise<{ sent: number; failed: number }> {
  if (!SUB_ID_RE.test(subscriptionId)) return { sent: 0, failed: 0 };
  const id = newAlertId();
  const line = "This is how new enquiries, Facebook leads and messages handed to you will show up.";
  await alertsClient().create({
    _id: id,
    _type: "ownerAlert",
    kind: "test",
    title: "Phone alerts work",
    lines: [line],
    links: [],
    urgent: true,
    createdAt: new Date().toISOString(),
  });
  return pushToPhones({ title: "Phone alerts work", body: line, url: `/todo/alerts?open=${id}`, tag: id, unread: await unreadCount() }, subscriptionId);
}
