import { requireCurrentBuyer } from "@/lib/auth/currentBuyer";
import { BuyerDetailsForm } from "@/components/BuyerDetailsForm";
import styles from "@/components/Portal.module.css";

export const metadata = {
  title: "Your Details | The Lexington",
};

export default async function AccountDetailsPage() {
  const { buyer } = await requireCurrentBuyer();
  const draft = buyer.contractDraft;
  const sentAt = buyer.buyerDetails?.submittedAt;

  return (
    <main className={styles.page}>
      <div className={styles.eyebrow}>Next steps</div>
      <h1 className={styles.title}>Your Details for the Agreement</h1>

      {!draft?.fillBaseUrl ? (
        <p className={styles.empty}>There is nothing to fill in on your account at the moment.</p>
      ) : (
        <>
          <p className={styles.lead}>
            These details complete your part of the agreement. When you send them, they are added to your draft
            agreement straight away and we are notified.
            {draft.fileUrl && (
              <>
                {" "}
                <a href={draft.fileUrl} target="_blank" rel="noreferrer" className={styles.inlineLink}>
                  Download the draft agreement
                </a>
                .
              </>
            )}
          </p>
          {sentAt && (
            <p className={styles.formOk}>
              Thank you. Your details were added to your draft agreement on{" "}
              {new Date(sentAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}, and we have been
              notified. To change anything, edit below and send again.
            </p>
          )}
          <BuyerDetailsForm key={sentAt ?? "new"} saved={buyer.buyerDetails} />
        </>
      )}
    </main>
  );
}
