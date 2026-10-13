import { createHash } from "node:crypto";

import {
  MAX_BEACON_BYTES,
  browserFromUserAgent,
  countryFromHeader,
  isFirstPartyBeacon,
  isLikelyBot,
  parseVisitBeacon,
} from "@/lib/visits/rules";
import { recordVisitBeacon } from "@/lib/visits/store";

export const dynamic = "force-dynamic";

/**
 * POST /api/visit: the anonymous record of a visit's route (`lib/visits/rules.ts`).
 *
 * A browser sends `{"v": visit, "n": 1 on the first send, "c": how it arrived,
 * "e": [events]}` here when a page has been seen or left, when the visitor did
 * something that matters (an enquiry, WhatsApp, a call, a unit opened) and when
 * something suggests trouble.
 *
 * WHAT THIS ROUTE NEVER DOES: store or log an IP address, a user agent, a
 * cookie, a referrer or a request body. Headers are read only to decide whether
 * to record, to take the country (a two-letter code from Vercel's edge) and the
 * browser's FAMILY; the rest goes with the request. The connection's address is
 * used, hashed, only for a one-minute limit held in this server's memory.
 *
 * THE CHECKS, cheapest first: body size; Global Privacy Control or Do Not Track
 * (the browser does not send for them either; this is the second lock); robots;
 * a first-party request (same origin, not a prefetch); a strict parse; then the
 * limits below, which bound what one connection, and one server, can write.
 *
 * ALWAYS 204, recorded or not, so the route cannot be used to learn anything.
 */

/** Sends a minute from one connection. A real visit makes a handful. */
const PER_CONNECTION_PER_MINUTE = 40;
/** New visits, and sends, one server copy records in a day. */
const NEW_VISITS_PER_DAY = 2_000;
const SENDS_PER_DAY = 12_000;

const recent = new Map<string, { windowStart: number; n: number }>();
let today = { day: "", visits: 0, sends: 0 };

function noContent(): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

function connectionKey(headers: Headers): string {
  const ip = (headers.get("x-forwarded-for") ?? headers.get("x-real-ip") ?? "").split(",")[0]?.trim() ?? "";
  return createHash("sha256").update(ip).digest("base64url").slice(0, 16);
}

function allowed(key: string, firstSend: boolean, nowMs: number): boolean {
  const window = recent.get(key);
  if (!window || nowMs - window.windowStart > 60_000) {
    recent.set(key, { windowStart: nowMs, n: 1 });
    if (recent.size > 5_000) {
      for (const [k, w] of recent) if (nowMs - w.windowStart > 60_000) recent.delete(k);
    }
  } else {
    window.n += 1;
    if (window.n > PER_CONNECTION_PER_MINUTE) return false;
  }

  const day = new Date(nowMs).toISOString().slice(0, 10);
  if (today.day !== day) today = { day, visits: 0, sends: 0 };
  if (today.sends >= SENDS_PER_DAY) return false;
  if (firstSend && today.visits >= NEW_VISITS_PER_DAY) return false;
  today.sends += 1;
  if (firstSend) today.visits += 1;
  return true;
}

/**
 * The body as text, or null once it is longer than the cap. Read in chunks so a
 * body with no (or a false) Content-Length cannot make the function buffer
 * megabytes before refusing it.
 */
async function readCappedBody(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const raw = await readCappedBody(request, MAX_BEACON_BYTES);
    if (raw === null) return noContent();

    const headers = request.headers;
    if (headers.get("sec-gpc") === "1" || headers.get("dnt") === "1") return noContent();
    if (isLikelyBot(headers.get("user-agent"))) return noContent();
    if (
      !isFirstPartyBeacon({
        origin: headers.get("origin"),
        secFetchSite: headers.get("sec-fetch-site"),
        host: headers.get("host"),
        forwardedHost: headers.get("x-forwarded-host"),
        secPurpose: headers.get("sec-purpose") ?? headers.get("purpose"),
      })
    ) {
      return noContent();
    }

    const beacon = parseVisitBeacon(raw);
    if (!beacon) return noContent();
    if (!allowed(connectionKey(headers), beacon.first, Date.now())) return noContent();

    await recordVisitBeacon(beacon, {
      country: countryFromHeader(headers.get("x-vercel-ip-country")),
      browser: browserFromUserAgent(headers.get("user-agent")),
    });
  } catch (thrown) {
    // A missing token, a network failure: the visitor loses nothing.
    console.error("[visit] beacon failed:", thrown instanceof Error ? thrown.message : "unknown");
  }
  return noContent();
}
