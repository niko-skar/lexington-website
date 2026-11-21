import "server-only";

import { compareNames, type NameMatchBand } from "@/lib/nameMatch";

// The name a Mobile Money number is registered in (21 Nov 2026). Niko: "can you make a little tool that pulls the
// workers name from their momo number? a lot of the time it's not the same as their actual name and I want to have it
// double confirmed before I send any money to an account, also helps to always have their full name on record".
//
// MoMo names are private: only a payments company can look one up. This asks Paystack's account-name lookup (a
// verification: nothing is paid, and it costs nothing), with the Paystack key in PAYSTACK_SECRET_KEY. Without the key
// the check says it isn't switched on.

export type MomoNetwork = "MTN" | "Telecel" | "AirtelTigo";

/** Paystack's code for each network (Telecel is still filed under Vodafone's old "VOD"). */
const BANK_CODES: Record<MomoNetwork, string> = { MTN: "MTN", Telecel: "VOD", AirtelTigo: "ATL" };

// By the number's prefix. A number moved to another network keeps its prefix, so the others are tried after.
const PREFIXES: ReadonlyArray<readonly [RegExp, MomoNetwork]> = [
  [/^0(24|25|53|54|55|59)/, "MTN"],
  [/^0(20|50)/, "Telecel"],
  [/^0(26|27|56|57)/, "AirtelTigo"],
];

/** The local 10-digit form ("0554349887") of a Ghana mobile number however it was typed, or null. */
export function localMomo(raw: string): string | null {
  let d = String(raw ?? "").replace(/\(0\)/g, "").replace(/\D/g, "");
  if (d.startsWith("00233")) d = d.slice(5);
  else if (d.startsWith("233")) d = d.slice(3);
  if (d.length === 9) d = `0${d}`;
  return /^0[25]\d{8}$/.test(d) ? d : null;
}

export function networkOf(local: string): MomoNetwork | null {
  return PREFIXES.find(([re]) => re.test(local))?.[1] ?? null;
}

export const momoCheckOn = () => Boolean(process.env.PAYSTACK_SECRET_KEY);

// Tests point this at a stand-in on the computer; never anywhere else in production.
const apiBase = () => (process.env.NODE_ENV !== "production" && process.env.PAYSTACK_API_BASE) || "https://api.paystack.co";

export type MomoLookup =
  | { ok: true; name: string; network: MomoNetwork }
  | { ok: false; reason: "off" | "invalid" | "not_found" | "unreachable" };

/** The registered name for a number: its prefix's network first, then the other two (a number moved network). */
export async function lookupMomoName(raw: string): Promise<MomoLookup & { number: string | null }> {
  const number = localMomo(raw);
  if (!number) return { ok: false, reason: "invalid", number: null };
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) return { ok: false, reason: "off", number };
  const first = networkOf(number);
  const order = [first, ...(["MTN", "Telecel", "AirtelTigo"] as const).filter((n) => n !== first)].filter(Boolean) as MomoNetwork[];
  let reached = false;
  for (const network of order) {
    try {
      const response = await fetch(
        `${apiBase()}/bank/resolve?account_number=${encodeURIComponent(number)}&bank_code=${encodeURIComponent(BANK_CODES[network])}`,
        { headers: { Authorization: `Bearer ${key}` }, cache: "no-store", signal: AbortSignal.timeout(12_000) }
      );
      reached = true;
      const body = (await response.json().catch(() => null)) as { status?: boolean; data?: { account_name?: string } } | null;
      const name = body?.data?.account_name?.replace(/\s+/g, " ").trim();
      if (response.ok && body?.status && name) return { ok: true, name, network, number };
      // A bad key is the same for every network: stop there.
      if (response.status === 401) return { ok: false, reason: "off", number };
    } catch {
      // Couldn't reach Paystack for this one: the next network is tried.
    }
  }
  return { ok: false, reason: reached ? "not_found" : "unreachable", number };
}

/** How the registered name compares with the worker's own name and with the MoMo name typed for them. */
export interface MomoMatch {
  /** "name": the worker's own name; "momoName": the name typed for their MoMo (someone else's account, as noted);
   * "close": nearly one of them (a person should look); "none": neither. */
  match: "name" | "momoName" | "close" | "none";
  vsName: NameMatchBand;
  vsMomoName: NameMatchBand | null;
}

/** "Same" (or nothing) typed as the MoMo name means the worker's own name. */
const typedMomoName = (momoName: string | undefined) => {
  const t = (momoName ?? "").trim();
  return !t || /^(same|same name|same as (above|name))\.?$/i.test(t) ? null : t;
};

export function compareMomo(registered: string, workerName: string, momoName?: string): MomoMatch {
  const name = compareNames(registered, workerName ?? "").band;
  const typed = typedMomoName(momoName);
  const other = typed ? compareNames(registered, typed).band : null;
  const match = name === "match" ? "name" : other === "match" ? "momoName" : name === "partial" || other === "partial" ? "close" : "none";
  return { match, vsName: name, vsMomoName: other };
}

/** A name as it reads best on screen: "FELIX K TETTEH" → "Felix K Tetteh". */
export const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase());
