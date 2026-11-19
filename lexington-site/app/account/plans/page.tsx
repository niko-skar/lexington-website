import Link from "next/link";
import { redirect } from "next/navigation";

import { PlanOptions, type DepositView, type PlanOptionView } from "@/components/PlanOptions";
import { PlanPicker } from "@/components/PlanPicker";
import styles from "@/components/Portal.module.css";
import { balanceFor, requireCurrentBuyer } from "@/lib/auth/currentBuyer";
import { PLAN_MODELS, planPickerSetup, seesOnlyPlans, shownPlanOptions } from "@/lib/planOptions";

export const metadata = {
  title: "Your Plans | The Lexington",
};

// The plans a buyer is choosing between (Niko, 12 Nov 2026: a buyer taking a two-bedroom flat and a studio on the 4th
// floor, drawn two ways): each plan as a 3D model with its sizes, its list price, the buyer's own price and the deposit.
// The plans and prices are on the buyer's account (`planOptions`); an account without them has no such page.
export default async function AccountPlansPage() {
  const { buyer } = await requireCurrentBuyer({ plansPage: true });
  // A buyer kept to this page has no account page to go back to.
  const only = seesOnlyPlans(buyer);
  const set = buyer.planOptions;
  const options: PlanOptionView[] = shownPlanOptions(buyer).map((o, i) => {
    const homes = (o.homes ?? []).filter((h) => h?.name && typeof h.areaSqm === "number").map((h) => ({ name: h.name, areaSqm: h.areaSqm }));
    const sum = Math.round(homes.reduce((s, h) => s + h.areaSqm, 0) * 100) / 100;
    return {
      key: o._key ?? String(i),
      title: o.title,
      model: o.model,
      script: PLAN_MODELS[o.model].script,
      poster: PLAN_MODELS[o.model].poster,
      homes,
      totalSqm: typeof o.totalSqm === "number" && o.totalSqm > 0 ? o.totalSqm : sum,
      listPriceUSD: typeof o.listPriceUSD === "number" && o.listPriceUSD > 0 ? o.listPriceUSD : null,
      priceUSD: o.priceUSD,
    };
  });
  // Homes to pick from (16 Nov 2026): when the account has them, the page is the picker and the older plans are not shown.
  // Some accounts can send their selection with a button (17 Nov 2026): lib/actions/planPicks.ts.
  const { picks, viewer, confirm } = planPickerSetup(buyer);
  if (!options.length && !picks.length) redirect("/account");

  const perHome = set?.depositPerHomeUSD ?? 0;
  const homeCount = set?.depositHomes ?? 0;
  const deposit: DepositView | null =
    perHome > 0 && homeCount > 0 ? { perHomeUSD: perHome, homes: homeCount, totalUSD: perHome * homeCount, paidUSD: balanceFor(buyer).totalPaidUSD } : null;

  return (
    <main className={styles.page}>
      <div className={styles.eyebrow}>{set?.eyebrow || "Your plans"}</div>
      <h1 className={styles.title}>{set?.title || (picks.length ? "Choose your homes" : "Choose your plan")}</h1>
      {set?.intro && (
        <p className={styles.lead} style={{ marginTop: "calc(var(--space-5) * -1)" }}>
          {set.intro}
        </p>
      )}
      {picks.length ? <PlanPicker picks={picks} viewer={viewer} confirm={confirm} /> : <PlanOptions options={options} deposit={deposit} approx={set?.approxSizes === true} exclVat={set?.exclVat === true} />}
      <p className={styles.lead} style={{ marginTop: "var(--space-7)" }}>
        {/* A plain <a> to the public site, not <Link>: a full page load, so the tag manager those pages load can't follow Back into the portal. */}
        {confirm ? "Questions?" : "Questions, or ready to choose?"} <a href="/contact">Talk to us</a>
        {only ? (
          "."
        ) : (
          <>
            , or go back to <Link href="/account">your account</Link>.
          </>
        )}
      </p>
    </main>
  );
}
