import { requireCurrentBuyer } from "@/lib/auth/currentBuyer";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { standardAgreementsQuery } from "@/lib/sanity/buyersQueries";
import type { StandardAgreements } from "@/lib/sanity/buyersTypes";
import styles from "@/components/Portal.module.css";

export const metadata = {
  title: "Documents | The Lexington",
};

export default async function AccountDocumentsPage() {
  const { buyer } = await requireCurrentBuyer();
  const standard = await getBuyersClient().fetch<StandardAgreements | null>(standardAgreementsQuery);
  // The draft the buyer is reviewing (with their own details once they have sent them) comes first.
  const draft = buyer.contractDraft;

  return (
    <main className={styles.page}>
      <div className={styles.eyebrow}>Documents</div>
      <h1 className={styles.title}>Your Documents</h1>

      {/* The general agreements only show while some are uploaded. */}
      {standard?.documents && standard.documents.length > 0 && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Standard Agreements</h2>
          <div className={styles.docList}>
            {standard.documents.map((doc, i) => (
              <a key={i} href={doc.fileUrl} target="_blank" rel="noreferrer" className={styles.docLink}>
                {doc.label}
                <span>Download</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Drafts for review sit here too, so the heading doesn't say "signed". */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Agreements</h2>
        {draft?.fileUrl || (buyer.signedAgreements && buyer.signedAgreements.length > 0) ? (
          <div className={styles.docList}>
            {draft?.fileUrl && (
              <a href={draft.fileUrl} target="_blank" rel="noreferrer" className={styles.docLink}>
                <div className={styles.docName}>
                  {draft.label || "Sale and Purchase Agreement (draft for your review)"}
                  {draft.detailsAddedAt && <small>Includes the details you sent</small>}
                </div>
                <span>Download</span>
              </a>
            )}
            {(buyer.signedAgreements ?? []).map((doc, i) => (
              <a key={i} href={doc.fileUrl} target="_blank" rel="noreferrer" className={styles.docLink}>
                {doc.label}
                <span>Download</span>
              </a>
            ))}
          </div>
        ) : (
          <p className={styles.empty}>No agreements uploaded yet.</p>
        )}
      </div>
    </main>
  );
}
