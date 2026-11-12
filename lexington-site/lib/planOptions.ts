import type { BuyerAccount, PlanOption } from "@/lib/sanity/buyersTypes";

// The 3D models in /public/3d/offer4f.iife.js, and each one's picture from straight above.
export const PLAN_MODELS: Record<string, { poster: string }> = {
  u4g1: { poster: "/3d/u4g1-plan.jpg" },
  u4g2: { poster: "/3d/u4g2-plan.jpg" },
};

/** The plans on an account that the site can show: each needs a name, a 3D model the site has, and a price. */
export function shownPlanOptions(buyer: Pick<BuyerAccount, "planOptions">): PlanOption[] {
  return (buyer.planOptions?.options ?? []).filter((o) => o?.title && o.model && PLAN_MODELS[o.model] && typeof o.priceUSD === "number" && o.priceUSD > 0);
}

/**
 * The buyer sees their plans (/account/plans) and nothing else: no overview, payments, documents or details
 * (Niko, 12 Nov 2026: a buyer still negotiating shouldn't see amounts paid or agreed). Set on the account
 * (`planOptions.only`); nothing is removed from it, so turning it off gives the whole portal back. Only counts
 * while there is a plan to show, so the account can never be left without a page.
 */
export function seesOnlyPlans(buyer: Pick<BuyerAccount, "planOptions" | "role">): boolean {
  return buyer.planOptions?.only === true && buyer.role !== "admin" && buyer.role !== "site" && shownPlanOptions(buyer).length > 0;
}
