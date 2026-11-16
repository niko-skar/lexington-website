import type { BuyerAccount, PlanOption, PlanPick } from "@/lib/sanity/buyersTypes";

// The 3D models in /public/3d/offer4f.iife.js, and each one's picture from straight above.
export const PLAN_MODELS: Record<string, { poster: string }> = {
  u4g1: { poster: "/3d/u4g1-plan.jpg" },
  u4g2: { poster: "/3d/u4g2-plan.jpg" },
};

// The 3D models in /public/3d/offerpick.iife.js (homes a buyer picks from), and each one's picture from straight above.
export const PICK_MODELS: Record<string, { poster: string }> = {
  u4t: { poster: "/3d/u4t-plan.jpg" },
  u5n: { poster: "/3d/u5n-plan.jpg" },
  u5s: { poster: "/3d/u5s-plan.jpg" },
  u3n: { poster: "/3d/u3n-plan.jpg" },
  u3s: { poster: "/3d/u3s-plan.jpg" },
};

/** The plans on an account that the site can show: each needs a name, a 3D model the site has, and a price. */
export function shownPlanOptions(buyer: Pick<BuyerAccount, "planOptions">): PlanOption[] {
  return (buyer.planOptions?.options ?? []).filter((o) => o?.title && o.model && PLAN_MODELS[o.model] && typeof o.priceUSD === "number" && o.priceUSD > 0);
}

/** The homes to pick from on an account that the site can show: each needs a name, a 3D model the site has, a size and a price. */
export function shownPlanPicks(buyer: Pick<BuyerAccount, "planOptions">): PlanPick[] {
  return (buyer.planOptions?.picks ?? []).filter(
    (p) => p?.title && p.model && PICK_MODELS[p.model] && typeof p.insideSqm === "number" && p.insideSqm > 0 && typeof p.priceUSD === "number" && p.priceUSD > 0
  );
}

/**
 * The buyer sees their plans (/account/plans) and nothing else: no overview, payments, documents or details
 * (Niko, 12 Nov 2026: a buyer still negotiating shouldn't see amounts paid or agreed). Set on the account
 * (`planOptions.only`); nothing is removed from it, so turning it off gives the whole portal back. Only counts
 * while there is a plan or a home to pick to show, so the account can never be left without a page.
 */
export function seesOnlyPlans(buyer: Pick<BuyerAccount, "planOptions" | "role">): boolean {
  return buyer.planOptions?.only === true && buyer.role !== "admin" && buyer.role !== "site" && (shownPlanOptions(buyer).length > 0 || shownPlanPicks(buyer).length > 0);
}
