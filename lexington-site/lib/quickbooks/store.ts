import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

import { alertsClient } from "@/lib/alerts/notify";

import type { QboEnvironment } from "./config";

// The QuickBooks connection lives in the PRIVATE buyers dataset, next to the alerts. A laptop or a
// preview build shares that dataset with the live site, so (like the alerts) it keeps its own
// documents: "qbo-connection-dev" never touches the live "qbo-connection-live".
//
// Intuit's access and refresh tokens are stored encrypted (AES-256-GCM, key derived from
// AUTH_SECRET), never in the page and never in a log line.

const LIVE = process.env.VERCEL_ENV === "production";
const CONNECTION_ID = LIVE ? "qbo-connection-live" : "qbo-connection-dev";
const LOG_PREFIX = LIVE ? "qbo-log-live-" : "qbo-log-dev-";
/** The log is for troubleshooting with Intuit: the latest few hundred lines are plenty. */
const KEEP_LOG = 300;

export interface QboConnection {
  environment: QboEnvironment;
  realmId: string;
  companyName: string | null;
  country: string | null;
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
  connectedAt: string;
  lastRefreshAt: string | null;
  /** "reconnect" once Intuit refuses the refresh token: someone has to sign in again. */
  status: "connected" | "reconnect";
  problem: string | null;
  /** Sanity's revision, so two token renewals at once can't overwrite each other. */
  rev: string;
}

interface StoredConnection {
  _id: string;
  _rev: string;
  environment: QboEnvironment;
  realmId: string;
  companyName?: string | null;
  country?: string | null;
  accessTokenEnc: string;
  accessExpiresAt: string;
  refreshTokenEnc: string;
  refreshExpiresAt: string;
  connectedAt: string;
  lastRefreshAt?: string | null;
  status?: "connected" | "reconnect";
  problem?: string | null;
}

let key: Buffer | null = null;
function encryptionKey(): Buffer {
  if (key) return key;
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("Missing AUTH_SECRET -- needed to encrypt the QuickBooks tokens.");
  key = Buffer.from(hkdfSync("sha256", secret, "lexington-quickbooks", "token-encryption-v1", 32));
  return key;
}

function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

function open(sealed: string): string {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !body) throw new Error("Unreadable QuickBooks token.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
}

/** The saved connection, or null when QuickBooks isn't connected (or the tokens can't be read). */
export async function loadConnection(): Promise<QboConnection | null> {
  const doc = await alertsClient().getDocument<StoredConnection>(CONNECTION_ID);
  if (!doc) return null;
  try {
    return {
      environment: doc.environment,
      realmId: doc.realmId,
      companyName: doc.companyName ?? null,
      country: doc.country ?? null,
      accessToken: open(doc.accessTokenEnc),
      accessExpiresAt: doc.accessExpiresAt,
      refreshToken: open(doc.refreshTokenEnc),
      refreshExpiresAt: doc.refreshExpiresAt,
      connectedAt: doc.connectedAt,
      lastRefreshAt: doc.lastRefreshAt ?? null,
      status: doc.status ?? "connected",
      problem: doc.problem ?? null,
      rev: doc._rev,
    };
  } catch {
    // AUTH_SECRET changed: the old tokens are useless, so treat it as "sign in again".
    return null;
  }
}

export interface NewTokens {
  accessToken: string;
  /** Seconds, as Intuit sends them. */
  expiresIn: number;
  refreshToken: string;
  refreshExpiresIn: number;
}

const inSeconds = (s: number) => new Date(Date.now() + s * 1000).toISOString();

/** A fresh connection after sign-in: replaces whatever was there. */
export async function saveNewConnection(
  environment: QboEnvironment,
  realmId: string,
  tokens: NewTokens,
  company: { name: string | null; country: string | null }
): Promise<void> {
  const now = new Date().toISOString();
  await alertsClient().createOrReplace({
    _id: CONNECTION_ID,
    _type: "quickbooksConnection",
    environment,
    realmId,
    companyName: company.name,
    country: company.country,
    accessTokenEnc: seal(tokens.accessToken),
    accessExpiresAt: inSeconds(tokens.expiresIn),
    refreshTokenEnc: seal(tokens.refreshToken),
    refreshExpiresAt: inSeconds(tokens.refreshExpiresIn),
    connectedAt: now,
    lastRefreshAt: null,
    status: "connected",
    problem: null,
  });
}

/**
 * Saves renewed tokens, but only on top of the revision they were renewed from. Answers false when
 * another request renewed first (the caller then re-reads the newer tokens).
 */
export async function saveRenewedTokens(fromRev: string, tokens: NewTokens): Promise<boolean> {
  try {
    await alertsClient()
      .patch(CONNECTION_ID)
      .ifRevisionId(fromRev)
      .set({
        accessTokenEnc: seal(tokens.accessToken),
        accessExpiresAt: inSeconds(tokens.expiresIn),
        refreshTokenEnc: seal(tokens.refreshToken),
        refreshExpiresAt: inSeconds(tokens.refreshExpiresIn),
        lastRefreshAt: new Date().toISOString(),
        status: "connected",
        problem: null,
      })
      .commit();
    return true;
  } catch {
    return false;
  }
}

export async function saveCompany(company: { name: string | null; country: string | null }): Promise<void> {
  await alertsClient().patch(CONNECTION_ID).set({ companyName: company.name, country: company.country }).commit();
}

export async function markNeedsReconnect(problem: string): Promise<void> {
  await alertsClient().patch(CONNECTION_ID).set({ status: "reconnect", problem }).commit();
}

export async function deleteConnection(): Promise<void> {
  await alertsClient().delete(CONNECTION_ID);
}

// ---------------------------------------------------------------------------------------------
// The log: every call to Intuit that failed, every sign-in/renewal/disconnect, with Intuit's own
// reference (intuit_tid) so a support ticket can point at the exact request.

export type QboAction = "connect" | "callback" | "refresh" | "api" | "test" | "disconnect" | "feed";

export interface QboLogLine {
  id: string;
  at: string;
  action: QboAction;
  ok: boolean;
  httpStatus: number | null;
  intuitTid: string | null;
  message: string;
}

export async function writeLog(line: Omit<QboLogLine, "id" | "at">): Promise<void> {
  const at = new Date().toISOString();
  const id = LOG_PREFIX + randomBytes(6).toString("hex");
  try {
    const client = alertsClient();
    await client.create({ _id: id, _type: "quickbooksLog", at, ...line, message: line.message.slice(0, 900) });
    // Now and then, drop the oldest lines beyond KEEP_LOG.
    if (Math.random() < 0.1) {
      const old = await client.fetch<string[]>(
        `*[_type == "quickbooksLog" && _id match $prefix] | order(at desc) [${KEEP_LOG}...${KEEP_LOG + 200}]._id`,
        { prefix: `${LOG_PREFIX}*` }
      );
      if (old.length) {
        const tx = client.transaction();
        old.forEach((oldId) => tx.delete(oldId));
        await tx.commit();
      }
    }
  } catch (error) {
    // The log must never break the thing being logged.
    console.error("[quickbooks] log write failed:", error instanceof Error ? error.message : error, line);
  }
}

export async function recentLog(limit = 25): Promise<QboLogLine[]> {
  const n = Math.max(1, Math.min(200, Math.floor(limit)));
  return alertsClient().fetch<QboLogLine[]>(
    `*[_type == "quickbooksLog" && _id match $prefix] | order(at desc) [0...${n}] {
      "id": _id, at, action, ok, httpStatus, intuitTid, message
    }`,
    { prefix: `${LOG_PREFIX}*` }
  );
}
