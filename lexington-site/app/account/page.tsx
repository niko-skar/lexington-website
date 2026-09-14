import { requireCurrentBuyer, balanceFor } from "@/lib/auth/currentBuyer";
import { formatUSD, formatFloor } from "@/lib/format";
import { formatGHS, formatMethod, usdEquivalent } from "@/lib/currency";
import styles from "@/components/Portal.module.css";

export const metadata = {
  title: "My Account | The Lexington",
};

export default async function AccountOverviewPage() {
  const { buyer, unit } = await requireCurrentBuyer();
  const { balance, hasMissingRates } = balanceFor(buyer);
  const payments = buyer.payments ?? [];
  const mostRecent = [...payments].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))[0];
  const mostRecentUSD = mostRecent ? usdEquivalent(mostRecent) : null;

  return (
    <main className={styles.page}>
      <div className={styles.eyebrow}>Welcome back</div>
      <h1 className={styles.title}>{buyer.name}</h1>

      <div className={styles.grid}>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Residence</div>
          <div className={styles.cardValue}>
            {buyer.unitNumber}
            {unit && ` · ${unit.bedroomType}`}
          </div>
          {unit && (
            <div className={styles.empty} style={{ marginTop: 8 }}>
              Floor {formatFloor(unit.floor)} · {unit.areaSqm} sqm
            </div>
          )}
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Contract Price</div>
          <div className={styles.cardValue}>{formatUSD(buyer.contractPriceUSD)}</div>
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
          One or more Cedi payments are missing an exchange rate, so the balance above may not be
          fully up to date — contact us if this looks wrong.
        </p>
      )}

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Most Recent Payment</h2>
        {mostRecent ? (
          <div className={styles.card}>
            <div className={styles.cardValue}>
              {mostRecent.currency === "USD"
                ? formatUSD(mostRecent.amount)
                : formatGHS(mostRecent.amount)}
              {mostRecent.currency !== "USD" && (
                <span className={styles.empty} style={{ marginLeft: 10, fontSize: "var(--fs-200)" }}>
                  {mostRecentUSD !== null ? `≈ ${formatUSD(Math.round(mostRecentUSD))}` : "rate missing"}
                </span>
              )}
            </div>
            <div className={styles.empty} style={{ marginTop: 8 }}>
              {mostRecent.date} {mostRecent.method && `· ${formatMethod(mostRecent.method)}`}
              {mostRecent.currency !== "USD" &&
                mostRecent.exchangeRate &&
                ` · ₵${mostRecent.exchangeRate} / $1`}
            </div>
          </div>
        ) : (
          <p className={styles.empty}>No payments recorded yet.</p>
        )}
      </div>
    </main>
  );
}
