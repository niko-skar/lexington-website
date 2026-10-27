import "server-only";

import { notifyOwner } from "@/lib/alerts/notify";

import { QBO_MINOR_VERSION, qboApiBase, qboEndpoints, qboKeys, type QboEnvironment, type QboKeys } from "./config";
import {
  loadConnection,
  markNeedsReconnect,
  saveCompany,
  saveRenewedTokens,
  writeLog,
  type NewTokens,
  type QboConnection,
} from "./store";

// Talking to Intuit: the token calls (sign-in code -> tokens, renewal, revoke) and the accounting
// API. Every failure is logged with Intuit's reference (intuit_tid) and comes back as a plain
// sentence for the admin page.

export class QboError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number | null = null,
    readonly intuitTid: string | null = null,
    /** The connection can't be used until someone signs in to QuickBooks again. */
    readonly needsReconnect = false
  ) {
    super(message);
  }
}

/** Renew the access token when it has less than this left (it lasts an hour). */
const RENEW_MARGIN_MS = 5 * 60 * 1000;

function basicAuth(keys: QboKeys): string {
  return "Basic " + Buffer.from(`${keys.clientId}:${keys.clientSecret}`).toString("base64");
}

interface TokenReply {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  x_refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
}

async function tokenCall(keys: QboKeys, body: URLSearchParams): Promise<{ tokens: NewTokens | null; reply: TokenReply; status: number; tid: string | null }> {
  const { token } = await qboEndpoints(keys.environment);
  const res = await fetch(token, {
    method: "POST",
    headers: {
      Authorization: basicAuth(keys),
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });
  const tid = res.headers.get("intuit_tid");
  const reply = (await res.json().catch(() => ({}))) as TokenReply;
  const tokens =
    res.ok && reply.access_token && reply.refresh_token
      ? {
          accessToken: reply.access_token,
          expiresIn: reply.expires_in ?? 3600,
          refreshToken: reply.refresh_token,
          refreshExpiresIn: reply.x_refresh_token_expires_in ?? 100 * 24 * 3600,
        }
      : null;
  return { tokens, reply, status: res.status, tid };
}

/** The sign-in code Intuit sent back -> tokens. */
export async function exchangeCode(code: string, redirectUri: string): Promise<NewTokens> {
  const keys = qboKeys();
  if (!keys) throw new QboError("The QuickBooks keys are not set on the website.");
  const { tokens, reply, status, tid } = await tokenCall(
    keys,
    new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri })
  );
  if (!tokens) {
    const message = `QuickBooks refused the sign-in (${reply.error ?? status}${reply.error_description ? `: ${reply.error_description}` : ""}).`;
    await writeLog({ action: "callback", ok: false, httpStatus: status, intuitTid: tid, message });
    throw new QboError(message, status, tid);
  }
  await writeLog({ action: "callback", ok: true, httpStatus: status, intuitTid: tid, message: "Signed in to QuickBooks." });
  return tokens;
}

async function tellOwnerToReconnect(problem: string): Promise<void> {
  await notifyOwner({
    kind: "books",
    title: "QuickBooks needs you to sign in again",
    lines: [problem, "Until then nothing goes into the books."],
    links: [{ label: "Open QuickBooks page", url: "/admin/quickbooks" }],
    urgent: true,
    tag: "quickbooks-reconnect",
  });
}

/**
 * Renews the tokens. Tries once more on a network or Intuit-side failure; a refused refresh token
 * (invalid_grant: expired, revoked, or the app was disconnected in QuickBooks) can't be retried, so
 * the connection is marked "sign in again" and Niko gets an alert.
 */
async function renew(conn: QboConnection, keys: QboKeys): Promise<QboConnection> {
  let last: { status: number; tid: string | null; reply: TokenReply } | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let result: Awaited<ReturnType<typeof tokenCall>>;
    try {
      result = await tokenCall(keys, new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refreshToken }));
    } catch (error) {
      last = { status: 0, tid: null, reply: { error: error instanceof Error ? error.message : "network error" } };
      continue;
    }
    if (result.tokens) {
      const saved = await saveRenewedTokens(conn.rev, result.tokens);
      await writeLog({ action: "refresh", ok: true, httpStatus: result.status, intuitTid: result.tid, message: "Renewed the QuickBooks login." });
      if (saved) {
        const fresh = await loadConnection();
        if (fresh) return fresh;
      }
      // Another request renewed at the same moment: use what it saved.
      const theirs = await loadConnection();
      if (theirs) return theirs;
      throw new QboError("The renewed QuickBooks login could not be saved.");
    }
    last = { status: result.status, tid: result.tid, reply: result.reply };
    if (result.reply.error === "invalid_grant" || result.status === 400 || result.status === 401) break;
  }
  const code = last?.reply.error ?? String(last?.status ?? "");
  const refused = code === "invalid_grant" || last?.status === 400 || last?.status === 401;
  const message = refused
    ? "QuickBooks no longer accepts the saved login (it expired, or the app was disconnected in QuickBooks). Sign in again."
    : `Renewing the QuickBooks login failed (${code || "no answer"}).`;
  await writeLog({ action: "refresh", ok: false, httpStatus: last?.status ?? null, intuitTid: last?.tid ?? null, message });
  if (refused) {
    await markNeedsReconnect(message);
    await tellOwnerToReconnect(message);
  }
  throw new QboError(message, last?.status ?? null, last?.tid ?? null, refused);
}

/** The connection with a usable access token, renewing it first when it is about to run out. */
export async function liveConnection(): Promise<{ conn: QboConnection; keys: QboKeys }> {
  const keys = qboKeys();
  if (!keys) throw new QboError("The QuickBooks keys are not set on the website.");
  const conn = await loadConnection();
  if (!conn) throw new QboError("QuickBooks is not connected yet.", null, null, true);
  if (conn.status === "reconnect") throw new QboError(conn.problem ?? "QuickBooks needs you to sign in again.", null, null, true);
  if (conn.environment !== keys.environment) {
    throw new QboError(
      `The saved connection is to a ${conn.environment} company but the website now has ${keys.environment} keys. Disconnect and sign in again.`,
      null,
      null,
      true
    );
  }
  if (new Date(conn.accessExpiresAt).getTime() - Date.now() > RENEW_MARGIN_MS) return { conn, keys };
  return { conn: await renew(conn, keys), keys };
}

interface Fault {
  Fault?: { Error?: { Message?: string; Detail?: string; code?: string }[]; type?: string };
}

function faultText(body: unknown): string | null {
  const errors = (body as Fault)?.Fault?.Error;
  if (!errors?.length) return null;
  return errors.map((e) => [e.Message, e.Detail, e.code ? `code ${e.code}` : null].filter(Boolean).join(" - ")).join("; ");
}

/**
 * One call to the QuickBooks accounting API for the connected company, e.g. qboApi("companyinfo/123").
 * A 401 renews the login and tries once more; 429 (too many requests) and 5xx wait and try once more.
 */
export async function qboApi<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown; query?: Record<string, string> } = {}): Promise<T> {
  const live = await liveConnection();
  const keys = live.keys;
  let conn = live.conn;
  for (let attempt = 1; ; attempt++) {
    const url = new URL(`/v3/company/${conn.realmId}/${path.replace(/^\//, "")}`, qboApiBase(conn.environment as QboEnvironment));
    url.searchParams.set("minorversion", String(QBO_MINOR_VERSION));
    for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);

    let res: Response;
    try {
      res = await fetch(url, {
        method: init.method ?? "GET",
        headers: {
          Authorization: `Bearer ${conn.accessToken}`,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        cache: "no-store",
      });
    } catch (error) {
      const message = `QuickBooks could not be reached (${error instanceof Error ? error.message : "network error"}).`;
      await writeLog({ action: "api", ok: false, httpStatus: null, intuitTid: null, message: `${path}: ${message}` });
      throw new QboError(message);
    }

    const tid = res.headers.get("intuit_tid");
    const body = await res.json().catch(() => null);
    if (res.ok) return body as T;

    if (res.status === 401 && attempt === 1) {
      // The access token was refused early: renew and try once more.
      conn = await renew(conn, keys);
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt === 1) {
      await new Promise((r) => setTimeout(r, res.status === 429 ? 2000 : 1000));
      continue;
    }

    const detail = faultText(body) ?? `HTTP ${res.status}`;
    const message = `QuickBooks answered ${path} with an error: ${detail}`;
    await writeLog({ action: "api", ok: false, httpStatus: res.status, intuitTid: tid, message });
    throw new QboError(message, res.status, tid, res.status === 401 || res.status === 403);
  }
}

interface CompanyInfoReply {
  CompanyInfo?: { CompanyName?: string; LegalName?: string; Country?: string; CompanyAddr?: { Country?: string } };
}

export async function fetchCompany(): Promise<{ name: string | null; country: string | null }> {
  const { conn } = await liveConnection();
  const reply = await qboApi<CompanyInfoReply>(`companyinfo/${conn.realmId}`);
  const info = reply.CompanyInfo;
  return {
    name: info?.CompanyName ?? info?.LegalName ?? null,
    country: info?.Country ?? info?.CompanyAddr?.Country ?? null,
  };
}

/** The "Test the connection" button: company name plus how many accounts the books have. */
export async function testConnection(): Promise<string> {
  const company = await fetchCompany();
  await saveCompany(company);
  const count = await qboApi<{ QueryResponse?: { totalCount?: number } }>("query", {
    query: { query: "select count(*) from Account" },
  });
  const accounts = count.QueryResponse?.totalCount ?? 0;
  const message = `Connected to ${company.name ?? "the company"}${company.country ? ` (${company.country})` : ""}: ${accounts} accounts in the books.`;
  await writeLog({ action: "test", ok: true, httpStatus: 200, intuitTid: null, message });
  return message;
}

/** Disconnect: tells Intuit to cancel the login (best effort) before the website forgets it. */
export async function revokeConnection(): Promise<void> {
  const keys = qboKeys();
  const conn = await loadConnection();
  if (!keys || !conn) return;
  const { revocation } = await qboEndpoints(conn.environment);
  try {
    const res = await fetch(revocation, {
      method: "POST",
      headers: { Authorization: basicAuth(keys), Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ token: conn.refreshToken }),
      cache: "no-store",
    });
    await writeLog({
      action: "disconnect",
      ok: res.ok,
      httpStatus: res.status,
      intuitTid: res.headers.get("intuit_tid"),
      message: res.ok ? "Disconnected: Intuit cancelled the login." : "Disconnected here; Intuit did not confirm cancelling the login.",
    });
  } catch (error) {
    await writeLog({
      action: "disconnect",
      ok: false,
      httpStatus: null,
      intuitTid: null,
      message: `Disconnected here; Intuit could not be reached (${error instanceof Error ? error.message : "network error"}).`,
    });
  }
}
