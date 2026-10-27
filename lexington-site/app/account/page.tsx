import Link from "next/link";

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
  // The saving only shows when an advertised price above the contract price is on the account.
  const listPrice = buyer.listPriceUSD ?? 0;
  const discount = listPrice > buyer.contractPriceUSD ? listPrice - buyer.contractPriceUSD : 0;
  const discountPercent = discount > 0 ? Math.round((discount / listPrice) * 1000) / 10 : 0;
  // Next steps show while a draft agreement is on the account (the buyer's details go into it).
  const draft = buyer.contractDraft;
  const detailsSent = buyer.buyerDetails?.submittedAt;

  return (
    <main className={styles.page}>
      <div className={styles.eyebrow}>Welcome back</div>
      <h1 className={styles.title}>{buyer.name}</h1>

      {draft && (draft.fileUrl || draft.fillBaseUrl) && (
        <section className={styles.section} aria-labelledby="next-steps">
          <h2 id="next-steps" className={styles.sectionTitle}>
            Next Steps
          </h2>
          <ol className={styles.stepList}>
            <li className={detailsSent ? styles.stepDone : styles.step}>
              <span className={styles.stepMark}>{detailsSent ? "✓" : "1"}</span>
              <div>
                <div className={styles.stepTitle}>Review your draft agreement</div>
                <div className={styles.stepText}>
                  Read it, ideally with your lawyer. You can send us any questions or changes with your details.
                </div>
                {draft.fileUrl && (
                  <a href={draft.fileUrl} target="_blank" rel="noreferrer" className={styles.stepLink}>
                    Download the draft
                  </a>
                )}
              </div>
            </li>
            {draft.fillBaseUrl && (
              <li className={detailsSent ? styles.stepDone : styles.step}>
                <span className={styles.stepMark}>{detailsSent ? "✓" : "2"}</span>
                <div>
                  <div className={styles.stepTitle}>Add your details</div>
                  <div className={styles.stepText}>
                    {detailsSent
                      ? `Done on ${new Date(detailsSent).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}. They are now in your draft agreement.`
                      : "Your citizenship, ID, home address and an emergency contact. They go straight into your agreement."}
                  </div>
                  <Link href="/account/details" className={styles.stepLink}>
                    {detailsSent ? "Check or change them" : "Add your details"}
                  </Link>
                </div>
              </li>
            )}
            <li className={styles.step}>
              <span className={styles.stepMark}>{draft.fillBaseUrl ? "3" : "2"}</span>
              <div>
                <div className={styles.stepTitle}>Sign the agreement</div>
                <div className={styles.stepText}>We will send you the final agreement to sign.</div>
              </div>
            </li>
            {draft.paymentStep && (
              <li className={styles.step}>
                <span className={styles.stepMark}>{draft.fillBaseUrl ? "4" : "3"}</span>
                <div>
                  <div className={styles.stepTitle}>Payment</div>
                  <div className={styles.stepText}>{draft.paymentStep}</div>
                </div>
              </li>
            )}
          </ol>
        </section>
      )}

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
        {discount > 0 && (
          <>
            <div className={styles.card}>
              <div className={styles.cardLabel}>Advertised Price</div>
              <div className={styles.cardValue}>{formatUSD(listPrice)}</div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardLabel}>Your Discount</div>
              <div className={styles.cardValueSage}>−{formatUSD(discount)}</div>
              <div className={styles.empty} style={{ marginTop: 8 }}>
                {discountPercent}% off · you save {formatUSD(discount)}
              </div>
            </div>
          </>
        )}
        <div className={styles.card}>
          <div className={styles.cardLabel}>{discount > 0 ? "Your Price" : "Contract Price"}</div>
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
            {mostRecent._key && (
              <p style={{ marginTop: 14 }}>
                <a className={styles.receiptLink} href={`/account/payments/receipt/${mostRecent._key}`} download>
                  Download receipt
                </a>
              </p>
            )}
          </div>
        ) : (
          <p className={styles.empty}>No payments recorded yet.</p>
        )}
      </div>
    </main>
  );
}
