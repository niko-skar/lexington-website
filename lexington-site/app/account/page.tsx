import Link from "next/link";

import { Unit3DPlan } from "@/components/Penthouse3D";
import { PlanPicker } from "@/components/PlanPicker";
import { requireCurrentBuyer, balanceFor } from "@/lib/auth/currentBuyer";
import { formatUSD, formatFloor, splitUnits } from "@/lib/format";
import { formatGHS, formatMethod, usdEquivalent } from "@/lib/currency";
import { MODELS } from "@/lib/models3d";
import { picksOnFirstPage, planPickerSetup } from "@/lib/planOptions";
import styles from "@/components/Portal.module.css";

export const metadata = {
  title: "My Account | The Lexington",
};

export default async function AccountOverviewPage() {
  const { buyer, unit, units } = await requireCurrentBuyer();
  const { balance, hasMissingRates, totalPaidUSD } = balanceFor(buyer);
  const homes = splitUnits(buyer.unitNumber);
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
  // Steps written for this buyer replace the standard ones; a step with an amount ticks itself once the payments reach it.
  const ownSteps = (buyer.nextSteps ?? []).filter((s) => s?.title);
  // Homes to pick from, right here on the first page (Niko, 17 Nov 2026: a buyer swapping one of his studios should see
  // the selection as soon as he signs in). Other accounts with plans get the link to /account/plans as before.
  const front = picksOnFirstPage(buyer) ? planPickerSetup(buyer) : null;
  const set = buyer.planOptions;
  // The buyer's own home in 3D, beside their name, the moment they sign in (Niko, 17 Nov 2026, for a buyer moved to a
  // studio he had not seen). Set on the account (`home3d`); shows the first of the account's homes that has a 3D model
  // on the Residences page, in that page's own 3D box.
  const home3d = buyer.home3d === true ? (units.find((u) => MODELS[u.unitNumber]) ?? null) : null;

  return (
    <main className={styles.page}>
      {home3d ? (
        <div className={styles.homeTop}>
          <div>
            <div className={styles.eyebrow}>Welcome back</div>
            <h1 className={styles.title}>{buyer.name}</h1>
            <h2 className={styles.sectionTitle}>Your home in 3D</h2>
            <p className={styles.lead}>
              {home3d.bedroomType} {home3d.unitNumber} · Floor {formatFloor(home3d.floor)} · {home3d.areaSqm} sqm. Turn it, zoom in, or step inside and
              walk around.
            </p>
          </div>
          <div className={styles.home3d}>
            <Unit3DPlan unitNumber={home3d.unitNumber} startLevel={MODELS[home3d.unitNumber].levels[0]} />
          </div>
        </div>
      ) : (
        <>
          <div className={styles.eyebrow}>Welcome back</div>
          <h1 className={styles.title}>{buyer.name}</h1>
        </>
      )}

      {front && (
        <section className={styles.section} aria-labelledby="your-picks">
          <h2 id="your-picks" className={styles.sectionTitle}>
            {set?.title || "Choose your homes"}
          </h2>
          {set?.intro && <p className={styles.lead}>{set.intro}</p>}
          <PlanPicker picks={front.picks} viewer={front.viewer} confirm={front.confirm} />
        </section>
      )}

      {!front && ((buyer.planOptions?.options?.length ?? 0) > 0 || (buyer.planOptions?.picks?.length ?? 0) > 0) && (
        <section className={styles.section} aria-labelledby="your-plans">
          <h2 id="your-plans" className={styles.sectionTitle}>
            Your Plans
          </h2>
          <p className={styles.lead}>
            {(buyer.planOptions?.picks?.length ?? 0) > 0
              ? "See each home in 3D, tick the ones you want, and your price adds up."
              : `Your home is drawn ${buyer.planOptions?.options?.length === 2 ? "two ways" : "more than one way"}. See each plan in 3D, with its size and your price.`}
          </p>
          <Link href="/account/plans" className={styles.stepLink}>
            Open your plans in 3D
          </Link>
        </section>
      )}

      {ownSteps.length > 0 && (
        <section className={styles.section} aria-labelledby="next-steps">
          <h2 id="next-steps" className={styles.sectionTitle}>
            Next Steps
          </h2>
          <ol className={styles.stepList}>
            {ownSteps.map((s, i) => {
              const done = s.done === true || (!!s.donePaidUSD && totalPaidUSD >= s.donePaidUSD - 0.5);
              return (
                <li key={s._key ?? i} className={done ? styles.stepDone : styles.step}>
                  <span className={styles.stepMark}>{done ? "✓" : i + 1}</span>
                  <div>
                    <div className={styles.stepTitle}>{s.title}</div>
                    {s.text && <div className={styles.stepText}>{s.text}</div>}
                    {s.link === "draft" && draft?.fileUrl && (
                      <a href={draft.fileUrl} target="_blank" rel="noreferrer" className={styles.stepLink}>
                        Download the draft
                      </a>
                    )}
                    {s.link === "details" && draft?.fillBaseUrl && (
                      <Link href="/account/details" className={styles.stepLink}>
                        {detailsSent ? "Check or change them" : "Add your details"}
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {ownSteps.length === 0 && draft && (draft.fileUrl || draft.fillBaseUrl) && (
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
          <div className={styles.cardLabel}>{homes.length > 1 ? "Residences" : "Residence"}</div>
          <div className={styles.cardValue}>
            {homes.length > 1 ? homes.join(" & ") : buyer.unitNumber}
            {homes.length < 2 && unit && ` · ${unit.bedroomType}`}
          </div>
          {homes.length > 1
            ? units.map((u) => (
                <div key={u.unitNumber} className={styles.empty} style={{ marginTop: 8 }}>
                  {u.unitNumber}: {u.bedroomType} · Floor {formatFloor(u.floor)} · {u.areaSqm} sqm
                </div>
              ))
            : unit && (
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
