import Link from "next/link";
import { redirect } from "next/navigation";

import { PlanOptions, type DepositView, type PlanOptionView } from "@/components/PlanOptions";
import styles from "@/components/Portal.module.css";
import { balanceFor, requireCurrentBuyer } from "@/lib/auth/currentBuyer";

export const metadata = {
  title: "Your Plans | The Lexington",
};

// The 3D models in /public/3d/offer4f.iife.js, and each one's picture from straight above.
const MODELS: Record<string, { poster: string }> = {
  u4g1: { poster: "/3d/u4g1-plan.jpg" },
  u4g2: { poster: "/3d/u4g2-plan.jpg" },
};

// The plans a buyer is choosing between (Niko, 12 Nov 2026: a buyer taking a two-bedroom flat and a studio on the 4th
// floor, drawn two ways): each plan as a 3D model with its sizes, its list price, the buyer's own price and the deposit.
// The plans and prices are on the buyer's account (`planOptions`); an account without them has no such page.
export default async function AccountPlansPage() {
  const { buyer } = await requireCurrentBuyer();
  const set = buyer.planOptions;
  const options: PlanOptionView[] = (set?.options ?? [])
    .filter((o) => o?.title && o.model && MODELS[o.model] && typeof o.priceUSD === "number" && o.priceUSD > 0)
    .map((o, i) => {
      const homes = (o.homes ?? []).filter((h) => h?.name && typeof h.areaSqm === "number").map((h) => ({ name: h.name, areaSqm: h.areaSqm }));
      return {
        key: o._key ?? String(i),
        title: o.title,
        model: o.model,
        poster: MODELS[o.model].poster,
        homes,
        totalSqm: Math.round(homes.reduce((sum, h) => sum + h.areaSqm, 0) * 100) / 100,
        listPriceUSD: typeof o.listPriceUSD === "number" && o.listPriceUSD > 0 ? o.listPriceUSD : null,
        priceUSD: o.priceUSD,
      };
    });
  if (!options.length) redirect("/account");

  const perHome = set?.depositPerHomeUSD ?? 0;
  const homeCount = set?.depositHomes ?? 0;
  const deposit: DepositView | null =
    perHome > 0 && homeCount > 0 ? { perHomeUSD: perHome, homes: homeCount, totalUSD: perHome * homeCount, paidUSD: balanceFor(buyer).totalPaidUSD } : null;

  return (
    <main className={styles.page}>
      <div className={styles.eyebrow}>{set?.eyebrow || "Your plans"}</div>
      <h1 className={styles.title}>{set?.title || "Choose your plan"}</h1>
      {set?.intro && (
        <p className={styles.lead} style={{ marginTop: "calc(var(--space-5) * -1)" }}>
          {set.intro}
        </p>
      )}
      <PlanOptions options={options} deposit={deposit} />
      <p className={styles.lead} style={{ marginTop: "var(--space-7)" }}>
        Questions, or ready to choose? <Link href="/contact">Talk to us</Link>, or go back to <Link href="/account">your account</Link>.
      </p>
    </main>
  );
}
