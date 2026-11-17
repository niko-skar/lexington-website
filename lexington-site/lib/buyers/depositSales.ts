import "server-only";
import { revalidatePath } from "next/cache";

import { notifyOwner } from "@/lib/alerts/notify";
import { usdEquivalent } from "@/lib/currency";
import { formatUSD, splitUnits } from "@/lib/format";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import type { Payment } from "@/lib/sanity/buyersTypes";
import { client } from "@/lib/sanity/client";

// A buyer's homes stay "reserved" on the website until the full deposit is in, then switch to "sold" by themselves (Niko,
// 17 Nov 2026: "mark his units as reserved until his full deposit is in then it'll switch to sold"). The account names
// its homes (unitNumber "405B, 504B") and the deposit (soldAtPaidUSD); the receipt cron calls this every 5 minutes, so
// a payment logged in /admin or typed in Studio both count. Once done, the account gets soldAt and is left alone.

interface Candidate {
  _id: string;
  name?: string;
  unitNumber?: string;
  soldAtPaidUSD: number;
  payments?: Payment[];
}

export interface DepositSale {
  account: string;
  name?: string;
  paidUSD: number;
  sold: string[];
}

export async function settleDepositSales({ dry = false }: { dry?: boolean } = {}): Promise<DepositSale[]> {
  const buyers = getBuyersClient();
  const accounts = await buyers.fetch<Candidate[]>(
    `*[_type == "buyerAccount" && !(_id in path("drafts.**")) && soldAtPaidUSD > 0 && !defined(soldAt)]{_id, name, unitNumber, soldAtPaidUSD, payments}`,
  );
  const out: DepositSale[] = [];
  for (const a of accounts) {
    let paidUSD = 0;
    for (const p of a.payments ?? []) paidUSD += usdEquivalent(p) ?? 0;
    if (paidUSD < a.soldAtPaidUSD - 0.5) continue;
    const numbers = splitUnits(a.unitNumber);
    const units = numbers.length
      ? await client.fetch<{ _id: string; unitNumber: string; status?: string }[]>(`*[_type == "unit" && unitNumber in $numbers]{_id, unitNumber, status}`, { numbers })
      : [];
    const toSell = units.filter((u) => u.status === "reserved");
    out.push({ account: a._id, name: a.name, paidUSD, sold: toSell.map((u) => u.unitNumber) });
    if (dry) continue;
    if (toSell.length) {
      const tx = client.transaction();
      for (const u of toSell) tx.patch(u._id, (p) => p.set({ status: "sold" }));
      await tx.commit();
    }
    await buyers.patch(a._id).set({ soldAt: new Date().toISOString() }).commit();
    const homes = toSell.map((u) => u.unitNumber);
    await notifyOwner({
      kind: "buyer",
      title: homes.length ? `${homes.join(" and ")} now sold` : `${a.name ?? "A buyer"}: deposit complete`,
      lines: [
        `${a.name ?? "The buyer"} has paid ${formatUSD(Math.round(paidUSD))}, the full deposit of ${formatUSD(a.soldAtPaidUSD)}.`,
        homes.length ? `On the website ${homes.join(" and ")} changed from reserved to sold.` : `None of ${numbers.join(", ") || "the account's homes"} was still reserved, so nothing changed on the website.`,
      ],
      links: [{ label: "Buyer account", url: `/admin/${a._id}` }],
      urgent: false,
    });
  }
  if (!dry && out.some((s) => s.sold.length)) {
    for (const path of ["/", "/residences", "/invest", "/reserve"]) revalidatePath(path);
  }
  return out;
}
