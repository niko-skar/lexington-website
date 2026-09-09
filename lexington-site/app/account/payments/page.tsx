import { requireCurrentBuyer, balanceFor } from "@/lib/auth/currentBuyer";
import { formatUSD } from "@/lib/format";
import { formatGHS, formatMethod, usdEquivalent } from "@/lib/currency";
import styles from "@/components/Portal.module.css";

export const metadata = {
  title: "Payments | The Lexington",
};

export default async function AccountPaymentsPage() {
  const { buyer } = await requireCurrentBuyer();
  const { balance, totalPaidUSD, hasMissingRates } = balanceFor(buyer);
  const payments = [...(buyer.payments ?? [])].sort((a, b) =>
    (b.date ?? "").localeCompare(a.date ?? "")
  );

  return (
    <main className={styles.page}>
      <div className={styles.eyebrow}>Payment History</div>
      <h1 className={styles.title}>All Payments</h1>

      <div className={styles.grid}>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Contract Price</div>
          <div className={styles.cardValue}>{formatUSD(buyer.contractPriceUSD)}</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Total Paid (USD equivalent)</div>
          <div className={styles.cardValue}>{formatUSD(Math.round(totalPaidUSD))}</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Balance Remaining</div>
          <div className={balance > 0 ? styles.cardValueClay : styles.cardValue}>
            {formatUSD(Math.round(Math.max(balance, 0)))}
          </div>
        </div>
      </div>

      {hasMissingRates && (
        <p className={styles.empty} style={{ color: "var(--clay)", marginBottom: "var(--space-6)" }}>
          One or more Cedi payments below are missing an exchange rate, so the totals above may not
          be fully up to date — contact us if this looks wrong.
        </p>
      )}

      {payments.length > 0 ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Amount</th>
              <th>USD Equivalent</th>
              <th>Method</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p, i) => {
              const usd = usdEquivalent(p);
              return (
                <tr key={i}>
                  <td>{p.date || "—"}</td>
                  <td>{p.currency === "USD" ? formatUSD(p.amount) : formatGHS(p.amount)}</td>
                  <td>
                    {p.currency === "USD" ? "—" : usd !== null ? formatUSD(Math.round(usd)) : "rate missing"}
                  </td>
                  <td>{formatMethod(p.method)}</td>
                  <td>{p.note || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className={styles.empty}>No payments recorded yet.</p>
      )}
    </main>
  );
}
