import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";

import { connectionKey } from "@/lib/reservation/limit";
import { getBuyersClient } from "@/lib/sanity/buyersClient";

// Failed sign-ins are counted, so nobody can guess a password by trying thousands of them (security
// check, 27 Oct 2026: the admin password and the account logins had no limit at all). Counted per
// connection, per account (an email) and, for the shared admin password, in total; a count that
// reaches its limit locks that one thing for a while. Kept in the PRIVATE dataset so every server
// copy sees the same count; only hashes are stored, never an address or an email.
//
// It never locks anyone out by breaking: if the count can't be read or written, sign-in works as
// before (and the error is logged).

const LIVE = process.env.VERCEL_ENV === "production";
const PREFIX = LIVE ? "loginguard-live-" : "loginguard-dev-";
/** A pause after every wrong password: slows guessing, unnoticeable to a person. */
const FAIL_PAUSE_MS = 600;

export interface GuardRule {
  key: string;
  /** Wrong tries allowed in the window... */
  max: number;
  windowMin: number;
  /** ...then locked for this long. */
  lockMin: number;
}

interface GuardDoc {
  _id: string;
  fails?: number;
  windowStart?: string;
  lockUntil?: string | null;
}

const idFor = (key: string) => PREFIX + createHash("sha256").update(key).digest("hex").slice(0, 24);

/** The counts that apply to this sign-in: always the connection; the account for an email login; the shared password for the office one. */
export async function loginRules(kind: "account" | "admin", email?: string): Promise<GuardRule[]> {
  const rules: GuardRule[] = [{ key: `ip:${connectionKey(await headers())}`, max: 10, windowMin: 15, lockMin: 15 }];
  if (kind === "account" && email) rules.push({ key: `email:${email.toLowerCase()}`, max: 8, windowMin: 15, lockMin: 30 });
  if (kind === "admin") rules.push({ key: "admin-password", max: 25, windowMin: 60, lockMin: 60 });
  return rules;
}

/** Minutes left on a lock, or 0 when the sign-in may go ahead. */
export async function lockedFor(rules: GuardRule[], nowMs = Date.now()): Promise<number> {
  try {
    const docs = await getBuyersClient().fetch<GuardDoc[]>(`*[_id in $ids]{ _id, lockUntil }`, { ids: rules.map((r) => idFor(r.key)) });
    const left = Math.max(0, ...docs.map((d) => (d.lockUntil ? Date.parse(d.lockUntil) - nowMs : 0)));
    return left > 0 ? Math.ceil(left / 60_000) : 0;
  } catch (error) {
    console.error("[login guard] couldn't read the counts:", error instanceof Error ? error.message : error);
    return 0;
  }
}

/** The next count for one rule. Pure. */
export function nextCount(doc: GuardDoc | null, rule: GuardRule, nowMs: number): Required<Omit<GuardDoc, "_id">> {
  const fresh = !doc?.windowStart || nowMs - Date.parse(doc.windowStart) > rule.windowMin * 60_000;
  const fails = (fresh ? 0 : (doc?.fails ?? 0)) + 1;
  const stillLocked = doc?.lockUntil && Date.parse(doc.lockUntil) > nowMs ? doc.lockUntil : null;
  return {
    fails,
    windowStart: fresh ? new Date(nowMs).toISOString() : (doc?.windowStart as string),
    lockUntil: fails >= rule.max ? new Date(nowMs + rule.lockMin * 60_000).toISOString() : stillLocked,
  };
}

/** A wrong password: counted on every rule, after a short pause. */
export async function recordFailure(rules: GuardRule[]): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, FAIL_PAUSE_MS));
  const client = getBuyersClient();
  for (const rule of rules) {
    try {
      const id = idFor(rule.key);
      const doc = await client.getDocument<GuardDoc>(id);
      await client.createOrReplace({ _id: id, _type: "loginGuard", ...nextCount(doc ?? null, rule, Date.now()) });
    } catch (error) {
      console.error("[login guard] couldn't count a failed sign-in:", error instanceof Error ? error.message : error);
    }
  }
}

/** Signed in: this connection's and this account's counts start again (the shared password's total stays). */
export async function recordSuccess(rules: GuardRule[]): Promise<void> {
  const ids = rules.filter((r) => r.key !== "admin-password").map((r) => idFor(r.key));
  try {
    const tx = getBuyersClient().transaction();
    for (const id of ids) tx.delete(id);
    await tx.commit();
  } catch (error) {
    console.error("[login guard] couldn't clear the counts:", error instanceof Error ? error.message : error);
  }
}

export const tooManyTries = (minutes: number) =>
  `Too many tries. For your security, please wait ${minutes} minute${minutes === 1 ? "" : "s"}, then try again.`;
