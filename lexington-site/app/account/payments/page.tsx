import { requireCurrentBuyer, balanceFor } from "@/lib/auth/currentBuyer";
import { formatUSD } from "@/lib/format";
import { formatGHS, formatMethod, usdEquivalent } from "@/lib/currency";
import { ensureReceiptNumbers } from "@/lib/receipts/issue";
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

  // Every payment gets its receipt number the first time it's looked at. If
  // that fails the page still works: the download button numbers it instead.
  let receiptNumbers = new Map<string, string>();
  try {
    receiptNumbers = await ensureReceiptNumbers(buyer._id, buyer.payments);
  } catch (err) {
    console.error("Couldn't issue receipt numbers:", err);
  }

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
          <div className={balance > 0 ? styles.cardValueSage : styles.cardValue}>
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
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Amount</th>
                <th>Rate</th>
                <th>USD Equivalent</th>
                <th>Method</th>
                <th>Note</th>
                <th>Receipt</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p, i) => {
                const usd = usdEquivalent(p);
                const isGHS = p.currency !== "USD";
                const number = p._key ? receiptNumbers.get(p._key) : undefined;
                return (
                  <tr key={p._key ?? i}>
                    <td>{p.date || "—"}</td>
                    <td>{isGHS ? formatGHS(p.amount) : formatUSD(p.amount)}</td>
                    <td>{isGHS ? (p.exchangeRate ? `₵${p.exchangeRate} / $1` : "missing") : "—"}</td>
                    <td>
                      {isGHS ? (usd !== null ? formatUSD(Math.round(usd)) : "rate missing") : "—"}
                    </td>
                    <td>{formatMethod(p.method)}</td>
                    <td>{p.note || "—"}</td>
                    <td className={styles.receiptCell}>
                      {p._key ? (
                        <>
                          {number && <span className={styles.receiptNumber}>{number}</span>}
                          <a
                            className={styles.receiptLink}
                            href={`/account/payments/receipt/${p._key}`}
                            download
                          >
                            Download receipt
                          </a>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={styles.empty}>No payments recorded yet.</p>
      )}
    </main>
  );
}
