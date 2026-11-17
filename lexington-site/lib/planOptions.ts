import { MODELS } from "@/lib/models3d";
import type { BuyerAccount, PlanOption, PlanPick } from "@/lib/sanity/buyersTypes";

// The 3D models in /public/3d/offer4f.iife.js, and each one's picture from straight above.
export const PLAN_MODELS: Record<string, { poster: string }> = {
  u4g1: { poster: "/3d/u4g1-plan.jpg" },
  u4g2: { poster: "/3d/u4g2-plan.jpg" },
};

// The 3D models in /public/3d/offerpick.iife.js (homes a buyer picks from), and each one's picture from straight above.
export const PICK_MODELS: Record<string, { poster: string }> = {
  u4t: { poster: "/3d/u4t-plan.jpg?v=3" }, // v3 (17 Nov 2026): bedroom 2 has its own en-suite, the guest WC is 0.8 m longer
  u5n: { poster: "/3d/u5n-plan.jpg" },
  u5s: { poster: "/3d/u5s-plan.jpg" },
  u3n: { poster: "/3d/u3n-plan.jpg" },
  u3s: { poster: "/3d/u3s-plan.jpg" },
  u1a: { poster: "/3d/u1a-plan.jpg" }, // 102B on the 1st floor (the same model as on the Residences page)
  u1d: { poster: "/3d/u1d-plan.jpg" }, // 108B on the 1st floor
};

// The one-floor homes of the Residences page (lib/models3d.ts), by the model's id. When every home a buyer picks from
// is one of these, the picker loads the Residences page's own 3D script and needs no script of its own (Niko, 17 Nov
// 2026: a buyer choosing among the studios on the website).
const SITE_PICK_MODELS: Record<string, { poster: string }> = Object.fromEntries(
  Object.values(MODELS)
    .filter((m) => m.levels.length === 1 && m.posters.main)
    .map((m) => [m.viewerId, { poster: m.posters.main!.wide }])
);

/** Which 3D script shows an account's homes to pick from: the picker's own, or the Residences page's. */
export type PickViewer = "pick" | "site";

/** A home to pick from, as the picker shows it. */
export interface PlanPickView {
  key: string;
  title: string;
  floorLabel: string;
  /** "home" for the main home, "studio" for the studios listed under it. */
  group: "home" | "studio";
  /** The model's id in the 3D script. */
  model: string;
  /** The home seen from straight above: shown until the 3D view is ready, and on its card. */
  poster: string;
  insideSqm: number;
  balconySqm: number;
  listPriceUSD: number | null;
  priceUSD: number;
  preselected: boolean;
  /** The home's number on the website, when it has one. */
  unitNumber: string;
}

/** The "Confirm my selection" button of a picker: how many homes it needs, and what was last sent. */
export interface PickConfirmView {
  count: number | null;
  sent: { keys: string[]; at: string } | null;
}

export interface PlanPickerSetup {
  picks: PlanPickView[];
  viewer: PickViewer;
  /** Null when the account has no button. */
  confirm: PickConfirmView | null;
}

/** The plans on an account that the site can show: each needs a name, a 3D model the site has, and a price. */
export function shownPlanOptions(buyer: Pick<BuyerAccount, "planOptions">): PlanOption[] {
  return (buyer.planOptions?.options ?? []).filter((o) => o?.title && o.model && PLAN_MODELS[o.model] && typeof o.priceUSD === "number" && o.priceUSD > 0);
}

const allOnSite = (picks: PlanPick[]) => picks.length > 0 && picks.every((p) => SITE_PICK_MODELS[p.model]);

/**
 * The homes to pick from on an account that the site can show: each needs a name, a 3D model the site has, a size and
 * a price. One script shows them all: the Residences page's when every home is on it, the picker's own otherwise (a
 * home that script doesn't have is then left out).
 */
export function shownPlanPicks(buyer: Pick<BuyerAccount, "planOptions">): PlanPick[] {
  const complete = (buyer.planOptions?.picks ?? []).filter(
    (p) => p?.title && p.model && typeof p.insideSqm === "number" && p.insideSqm > 0 && typeof p.priceUSD === "number" && p.priceUSD > 0
  );
  return allOnSite(complete) ? complete : complete.filter((p) => PICK_MODELS[p.model]);
}

/** Everything the picker needs from an account. The page and the "Confirm" action both read it, so they agree on the homes and their keys. */
export function planPickerSetup(buyer: Pick<BuyerAccount, "planOptions">): PlanPickerSetup {
  const shown = shownPlanPicks(buyer);
  const viewer: PickViewer = allOnSite(shown) ? "site" : "pick";
  const picks: PlanPickView[] = shown.map((p, i) => ({
    key: p._key ?? String(i),
    title: p.title,
    floorLabel: p.floorLabel ?? "",
    group: p.group === "studio" ? "studio" : "home",
    model: p.model,
    poster: (viewer === "site" ? SITE_PICK_MODELS : PICK_MODELS)[p.model].poster,
    insideSqm: p.insideSqm,
    balconySqm: typeof p.balconySqm === "number" && p.balconySqm > 0 ? p.balconySqm : 0,
    listPriceUSD: typeof p.listPriceUSD === "number" && p.listPriceUSD > 0 ? p.listPriceUSD : null,
    priceUSD: p.priceUSD,
    preselected: p.preselected === true,
    unitNumber: p.unitNumber?.trim() ?? "",
  }));
  const set = buyer.planOptions;
  let confirm: PickConfirmView | null = null;
  if (set?.confirm === true && picks.length > 0) {
    const count = typeof set.pickCount === "number" && set.pickCount >= 1 && set.pickCount <= picks.length ? Math.floor(set.pickCount) : null;
    // A selection sent earlier only still counts while every home in it is still on the page.
    const sentKeys = set.chosen?.at && Array.isArray(set.chosen.keys) ? set.chosen.keys.filter((k) => picks.some((p) => p.key === k)) : [];
    const sent = set.chosen?.at && sentKeys.length > 0 && sentKeys.length === set.chosen.keys.length ? { keys: sentKeys, at: set.chosen.at } : null;
    confirm = { count, sent };
  }
  return { picks, viewer, confirm };
}

/** The homes to pick from are on the account's first page as well (`planOptions.front`), while there are any. */
export function picksOnFirstPage(buyer: Pick<BuyerAccount, "planOptions">): boolean {
  return buyer.planOptions?.front === true && shownPlanPicks(buyer).length > 0;
}

/** A day as the portal writes it, in Ghana's time whatever the reader's own clock: "17 November 2026". */
export function portalDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Accra" });
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
