import "server-only";

import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { QBO_VENDORS_ID } from "@/lib/site/ids";
import type { QboVendor } from "@/lib/suppliers/shared";
import { qboApi } from "./client";
import { loadConnection } from "./store";

// The company's suppliers as QuickBooks has them (its vendors; Niko, 2 Nov 2026: "you can pull the supplier list from
// quickbooks so it all matches"), kept in the website so the supplier list opens at once. Read again when a few
// minutes old (the 15-minute QuickBooks run, opening Suppliers) and straight after the site adds one.

export const VENDORS_STALE_MS = 10 * 60_000;

export interface VendorCache {
  vendors: QboVendor[];
  fetchedAt: string | null;
}

type RawVendor = {
  Id: string;
  DisplayName?: string;
  CompanyName?: string;
  PrimaryPhone?: { FreeFormNumber?: string };
  Mobile?: { FreeFormNumber?: string };
  PrimaryEmailAddr?: { Address?: string };
  Balance?: number;
};

const toVendor = (v: RawVendor): QboVendor => ({
  id: v.Id,
  name: (v.DisplayName ?? v.CompanyName ?? "").trim(),
  company: (v.CompanyName ?? "").trim(),
  phone: (v.PrimaryPhone?.FreeFormNumber ?? v.Mobile?.FreeFormNumber ?? "").trim(),
  email: (v.PrimaryEmailAddr?.Address ?? "").trim(),
  balance: Math.round((Number(v.Balance) || 0) * 100) / 100,
});

export async function cachedVendors(): Promise<VendorCache> {
  const doc = await getBuyersClient().fetch<{ vendors?: QboVendor[]; fetchedAt?: string } | null>(`*[_id == $id][0]{ vendors, fetchedAt }`, { id: QBO_VENDORS_ID });
  const vendors = Array.isArray(doc?.vendors) ? doc.vendors.filter((v) => v && typeof v.id === "string" && typeof v.name === "string" && v.name) : [];
  return {
    vendors: vendors.map((v) => ({ id: v.id, name: v.name, company: v.company ?? "", phone: v.phone ?? "", email: v.email ?? "", balance: Number(v.balance) || 0 })),
    fetchedAt: doc?.fetchedAt ?? null,
  };
}

async function saveVendors(vendors: QboVendor[]): Promise<VendorCache> {
  const fetchedAt = new Date().toISOString();
  await getBuyersClient().createOrReplace({
    _id: QBO_VENDORS_ID,
    _type: "qboVendors",
    vendors: vendors.map((v) => ({ _key: `v${v.id.replace(/[^A-Za-z0-9]/g, "")}`, ...v })),
    fetchedAt,
  });
  return { vendors, fetchedAt };
}

/** Every active supplier in QuickBooks, by name (QuickBooks hands them over a thousand at a time). */
export async function qboVendorList(): Promise<QboVendor[]> {
  const out: RawVendor[] = [];
  for (let start = 1; start < 20_000; start += 1000) {
    const reply = await qboApi<{ QueryResponse?: { Vendor?: RawVendor[] } }>("query", {
      query: { query: `select * from Vendor where Active = true startposition ${start} maxresults 1000` },
    });
    const page = reply.QueryResponse?.Vendor ?? [];
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out
    .map(toVendor)
    .filter((v) => v.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Read again from QuickBooks when a few minutes old (or now, when forced). Never throws: the list as it was stays. */
export async function refreshVendors(force = false): Promise<VendorCache> {
  const cached = await cachedVendors().catch(() => ({ vendors: [], fetchedAt: null }) as VendorCache);
  try {
    if (!force && cached.fetchedAt && Date.now() - Date.parse(cached.fetchedAt) < VENDORS_STALE_MS) return cached;
    const conn = await loadConnection();
    if (!conn || conn.status !== "connected") return cached;
    return await saveVendors(await qboVendorList());
  } catch (error) {
    console.error("[quickbooks vendors]", error instanceof Error ? error.message : error);
    return cached;
  }
}

/** A supplier added from the site: made in QuickBooks first (so both have it), then the list read again. */
export async function addVendor(name: string, phone: string): Promise<QboVendor> {
  const conn = await loadConnection();
  if (!conn || conn.status !== "connected") throw new Error("QuickBooks isn't connected: add the supplier there, or connect it on the QuickBooks page.");
  const reply = await qboApi<{ Vendor: RawVendor }>("vendor", {
    method: "POST",
    body: { DisplayName: name, ...(phone ? { PrimaryPhone: { FreeFormNumber: phone } } : {}) },
  });
  const vendor = toVendor(reply.Vendor);
  const fresh = await refreshVendors(true);
  // QuickBooks' list can be a moment behind a supplier just made: it goes on now.
  if (!fresh.vendors.some((v) => v.id === vendor.id)) await saveVendors([...fresh.vendors, vendor].sort((a, b) => a.name.localeCompare(b.name)));
  return vendor;
}
