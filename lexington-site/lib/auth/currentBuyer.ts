import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";

import { getPortalView } from "./portalView";
import { getBuyerSession } from "./session";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { buyerAccountByEmailQuery, buyerPortalAccountByIdQuery } from "@/lib/sanity/buyersQueries";
import type { BuyerAccount } from "@/lib/sanity/buyersTypes";
import { client } from "@/lib/sanity/client";
import { unitByNumberQuery } from "@/lib/sanity/queries";
import type { Unit } from "@/lib/sanity/types";
import { usdEquivalent } from "@/lib/currency";
import { splitUnits } from "@/lib/format";
import { seesOnlyPlans } from "@/lib/planOptions";

/** The account behind a sign-in: asked for once for a page, however many parts of it (the header, the page) need it. */
export const loadBuyerAccount = cache((email: string) => getBuyersClient().fetch<BuyerAccount | null>(buyerAccountByEmailQuery, { email }));
const loadBuyerAccountById = cache((id: string) => getBuyersClient().fetch<BuyerAccount | null>(buyerPortalAccountByIdQuery, { id }));

/**
 * Whose portal this request shows. Normally the signed-in buyer's. `viewing` = an admin looking at a buyer's portal
 * as the buyer sees it ("View portal", lib/auth/portalView.ts): the account is that buyer's, nobody is signed in as
 * them, and everything that saves or sends must refuse. Asked for once for a page (the header and the page share it).
 */
export const portalAccount = cache(async (): Promise<{ buyer: BuyerAccount | null; viewing: boolean; signedIn: boolean }> => {
  const viewId = await getPortalView();
  if (viewId) {
    const viewed = await loadBuyerAccountById(viewId);
    if (viewed && viewed.role !== "admin" && viewed.role !== "site") return { buyer: viewed, viewing: true, signedIn: true };
  }
  const session = await getBuyerSession();
  if (!session) return { buyer: null, viewing: false, signedIn: false };
  return { buyer: await loadBuyerAccount(session.email), viewing: false, signedIn: true };
});

// Defense in depth alongside middleware.ts -- cheap, and protects against
// any future matcher misconfiguration. Redirects (rather than returning
// null) so every /account page can call this without its own guard.
// `plansPage` is passed by /account/plans alone: an account kept to its plans is sent there from everywhere else.
// `viewing` in the answer: an admin is only looking (see portalAccount); an action that saves or sends must stop there.
export async function requireCurrentBuyer(options: { plansPage?: boolean } = {}): Promise<{ buyer: BuyerAccount; unit: Unit | null; units: Unit[]; viewing: boolean }> {
  const { buyer, viewing, signedIn } = await portalAccount();
  if (!signedIn) {
    redirect("/login");
  }

  if (!buyer) {
    // The account behind this session no longer exists (e.g. deleted) --
    // the cookie itself is still a validly-signed token. Cookies can only
    // be written from a Server Action/Route Handler, not here, so this
    // can't clear it -- see the matching existence check in
    // app/login/page.tsx, which is what actually breaks the redirect loop
    // this would otherwise cause.
    redirect("/login");
  }

  // Admin accounts have no unit or payments -- the buyer dashboard doesn't apply.
  if (buyer.role === "admin") {
    redirect("/admin/crm");
  }
  // Site to-do accounts (the foreman) only have the list at /todo.
  if (buyer.role === "site") {
    redirect("/todo");
  }
  // A buyer kept to their plans (planOptions.only) sees that page and no other.
  if (!options.plansPage && seesOnlyPlans(buyer)) {
    redirect("/account/plans");
  }

  // One home, or several on one account ("Studio 1, 204B"): each looked up, in the account's order.
  const found = await Promise.all(splitUnits(buyer.unitNumber).map((unitNumber) => client.fetch<Unit | null>(unitByNumberQuery, { unitNumber })));
  const units = found.filter((u): u is Unit => !!u);

  return { buyer, unit: units[0] ?? null, units, viewing };
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
