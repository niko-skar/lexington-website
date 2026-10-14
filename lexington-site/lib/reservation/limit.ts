import "server-only";
import { createHash } from "node:crypto";

// A small memory-only limit on how often one connection can submit the reservation
// form. It is held in this server's memory, so it is a speed bump (each Vercel
// instance counts for itself), not a wall: the real stop for repeats is the
// per-address daily count kept in the CRM (countRecentReservationRequests).
// The connection is only ever kept as a short hash, and only for the window.

const hits = new Map<string, number[]>();
const MAX_KEYS = 5000;

/** True if this key may go ahead (and counts it); false once it has used `max` in `windowMs`. */
export function allow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > MAX_KEYS) {
    // Forget the oldest keys; Map keeps insertion order.
    for (const k of hits.keys()) {
      hits.delete(k);
      if (hits.size <= MAX_KEYS * 0.8) break;
    }
  }
  return true;
}

export function connectionKey(headers: Headers): string {
  const ip = (headers.get("x-forwarded-for") ?? headers.get("x-real-ip") ?? "").split(",")[0]?.trim() ?? "";
  return createHash("sha256").update(ip || "unknown").digest("base64url").slice(0, 16);
}
