import "server-only";
import { redirect } from "next/navigation";

import { getBuyerSession } from "./session";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { buyerAccountByEmailQuery } from "@/lib/sanity/buyersQueries";
import type { BuyerAccount } from "@/lib/sanity/buyersTypes";
import { client } from "@/lib/sanity/client";
import { unitByNumberQuery } from "@/lib/sanity/queries";
import type { Unit } from "@/lib/sanity/types";
import { usdEquivalent } from "@/lib/currency";

// Defense in depth alongside middleware.ts -- cheap, and protects against
// any future matcher misconfiguration. Redirects (rather than returning
// null) so every /account page can call this without its own guard.
export async function requireCurrentBuyer(): Promise<{ buyer: BuyerAccount; unit: Unit | null }> {
  const session = await getBuyerSession();
  if (!session) {
    redirect("/login");
  }

  const buyer = await getBuyersClient().fetch<BuyerAccount | null>(buyerAccountByEmailQuery, {
    email: session.email,
  });
  if (!buyer) {
    // The account behind this session no longer exists (e.g. deleted) --
    // the cookie itself is still a validly-signed token. Cookies can only
    // be written from a Server Action/Route Handler, not here, so this
    // can't clear it -- see the matching existence check in
    // app/login/page.tsx, which is what actually breaks the redirect loop
    // this would otherwise cause.
    redirect("/login");
  }

  const unit = await client.fetch<Unit | null>(unitByNumberQuery, { unitNumber: buyer.unitNumber });

  return { buyer, unit };
}

export function balanceFor(buyer: BuyerAccount) {
  const payments = buyer.payments ?? [];
  let totalPaidUSD = 0;
  let hasMissingRates = false;

  for (const p of payments) {
    const usd = usdEquivalent(p);
    if (usd === null) {
      hasMissingRates = true;
      continue;
    }
    totalPaidUSD += usd;
  }

  return {
    totalPaidUSD,
    balance: buyer.contractPriceUSD - totalPaidUSD,
    hasMissingRates,
  };
}
