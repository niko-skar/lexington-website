import { notFound } from "next/navigation";
import Link from "next/link";

import { formatUSD } from "@/lib/format";
import { formatGHS, formatMethod } from "@/lib/currency";
import { ensureReceiptNumbers } from "@/lib/receipts/issue";
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

  const payments = [...(buyer.payments ?? [])].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  let receiptNumbers = new Map<string, string>();
  if (payments.length > 0) {
    try {
      receiptNumbers = await ensureReceiptNumbers(buyer._id, buyer.payments);
    } catch (err) {
      console.error("Couldn't issue receipt numbers:", err);
    }
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

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Payments &amp; Receipts</h2>
        {payments.length === 0 ? (
          <p className={styles.empty}>No payments recorded yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Method</th>
                  <th>Receipt</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p, i) => (
                  <tr key={p._key ?? i}>
                    <td>{p.date || "—"}</td>
                    <td>{p.currency === "USD" ? formatUSD(p.amount) : formatGHS(p.amount)}</td>
                    <td>{formatMethod(p.method)}</td>
                    <td className={styles.receiptCell}>
                      {p._key ? (
                        <>
                          {receiptNumbers.get(p._key) && (
                            <span className={styles.receiptNumber}>{receiptNumbers.get(p._key)}</span>
                          )}
                          <a className={styles.receiptLink} href={`/admin/receipts/${buyer._id}/${p._key}`} download>
                            Download receipt
                          </a>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
