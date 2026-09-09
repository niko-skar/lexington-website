import { notFound } from "next/navigation";
import Link from "next/link";

import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { buyerAccountByIdQuery } from "@/lib/sanity/buyersQueries";
import type { BuyerAccount } from "@/lib/sanity/buyersTypes";
import { ResetPasswordForm } from "@/components/ResetPasswordForm";
import styles from "@/components/Portal.module.css";

export const metadata = {
  title: "Buyer | The Lexington",
};

export default async function AdminBuyerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const buyer = await getBuyersClient().fetch<BuyerAccount | null>(buyerAccountByIdQuery, { id });

  if (!buyer) {
    notFound();
  }

  return (
    <main className={styles.page}>
      <div className={styles.eyebrow}>Buyer</div>
      <h1 className={styles.title}>{buyer.name}</h1>
      <p className={styles.empty} style={{ marginBottom: "var(--space-7)" }}>
        {buyer.email} · Unit {buyer.unitNumber}
      </p>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Reset Password</h2>
        <ResetPasswordForm buyerId={buyer._id} />
      </div>

      <p className={styles.empty}>
        Payments, documents and contract price are edited in{" "}
        <Link href="/buyers-studio" style={{ color: "var(--clay)" }}>
          Sanity Studio
        </Link>
        , not here.
      </p>
    </main>
  );
}
