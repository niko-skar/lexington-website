import "server-only";
import { createHash } from "node:crypto";

import { alertsClient, clip, LIVE, newAlertId, OFFICE, PREFIX, pushToPeople, pushToPhones, SUB_PREFIX, unreadCount, vapid } from "./notify";
import type { AlertsData, OwnerAlert, PushState } from "./shared";

// The reading side of Niko's alerts (the office only: the API checks who asks), and the phones
// that get them: the office's, and since 27 Oct 2026 a site login's (the foreman gets a buzz when
// the office adds a job). Saving one is notifyOwner() in ./notify.
export { notifyOwner, unreadCount } from "./notify";

const ID_RE = LIVE ? /^alert-live-[a-f0-9]{12}$/ : /^alert-dev-[a-f0-9]{12}$/;
const SUB_ID_RE = LIVE ? /^pushsub-live-[a-f0-9]{24}$/ : /^pushsub-dev-[a-f0-9]{24}$/;
const SHOWN = 120;

const FIELDS = `{ "id": _id, kind, title, "lines": coalesce(lines, []), "links": coalesce(links[]{ label, url }, []), "urgent": coalesce(urgent, false), createdAt, "readAt": coalesce(readAt, null) }`;

export async function listAlerts(): Promise<AlertsData> {
  const [alerts, unread] = await Promise.all([
    alertsClient().fetch<OwnerAlert[]>(
      `*[_type == "ownerAlert" && string::startsWith(_id, $prefix)] | order(createdAt desc)[0...${SHOWN}] ${FIELDS}`,
      { prefix: PREFIX }
    ),
    unreadCount(),
  ]);
  return { alerts, unread };
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

/** The website's side of phone alerts for one person ("office", or a site login's id): its keys, and that person's phones. */
export async function pushState(owner: string): Promise<PushState> {
  const keys = vapid();
  const subs = await alertsClient().fetch<Array<{ _id: string; name?: string; createdAt?: string }>>(
    `*[_type == "pushSubscription" && string::startsWith(_id, $prefix) && coalesce(owner, $office) == $owner] | order(createdAt asc){ _id, name, createdAt }`,
    { prefix: SUB_PREFIX, office: OFFICE, owner }
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

/**
 * This phone gets the alerts of the person signed in on it from now on. Asked again on every app
 * start: the same phone is one entry, and it moves to whoever signed in on it last.
 */
export async function savePushSubscription(sub: { endpoint: string; p256dh: string; auth: string }, name: string, owner: string): Promise<string> {
  const id = subId(sub.endpoint);
  const client = alertsClient();
  const before = await client.fetch<{ createdAt?: string; owner?: string } | null>(`*[_id == $id][0]{ createdAt, owner }`, { id });
  await client.createOrReplace({
    _id: id,
    _type: "pushSubscription",
    endpoint: sub.endpoint,
    p256dh: sub.p256dh,
    auth: sub.auth,
    name: clip(name.trim() || "Phone", 40),
    owner,
    createdAt: before?.createdAt && (before.owner ?? OFFICE) === owner ? before.createdAt : new Date().toISOString(),
  });
  return id;
}

/** This phone stops getting them. Only ever one of the asking person's own phones. */
export async function removePushSubscription(endpointOrId: string, owner: string): Promise<void> {
  const id = SUB_ID_RE.test(endpointOrId) ? endpointOrId : subId(endpointOrId);
  const client = alertsClient();
  const sub = await client.fetch<{ owner?: string } | null>(`*[_id == $id && _type == "pushSubscription"][0]{ owner }`, { id });
  if (sub && (sub.owner ?? OFFICE) === owner) await client.delete(id);
}

/**
 * "Send a test": a phone alert to the phone that asked, if it is one of theirs. The office's lands
 * in the Alerts list too; a site login's is only the buzz.
 */
export async function sendTest(subscriptionId: string, owner: string): Promise<{ sent: number; failed: number }> {
  if (!SUB_ID_RE.test(subscriptionId)) return { sent: 0, failed: 0 };
  if (owner !== OFFICE) {
    return pushToPeople(
      [owner],
      { title: "Phone alerts work", body: "This is how new jobs from the office will show up.", url: "/todo", tag: `test-${subscriptionId}` },
      subscriptionId
    );
  }
  const id = newAlertId();
  const line = "This is how new enquiries, Facebook leads, messages handed to you and jobs the foreman adds will show up.";
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
