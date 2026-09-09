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

  return (
    <main className={styles.page}>
      <div className={styles.eyebrow}>Documents</div>
      <h1 className={styles.title}>Your Documents</h1>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Standard Agreements</h2>
        {standard?.documents && standard.documents.length > 0 ? (
          <div className={styles.docList}>
            {standard.documents.map((doc, i) => (
              <a key={i} href={doc.fileUrl} target="_blank" rel="noreferrer" className={styles.docLink}>
                {doc.label}
                <span>Download</span>
              </a>
            ))}
          </div>
        ) : (
          <p className={styles.empty}>No standard agreements uploaded yet.</p>
        )}
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Signed Agreements</h2>
        {buyer.signedAgreements && buyer.signedAgreements.length > 0 ? (
          <div className={styles.docList}>
            {buyer.signedAgreements.map((doc, i) => (
              <a key={i} href={doc.fileUrl} target="_blank" rel="noreferrer" className={styles.docLink}>
                {doc.label}
                <span>Download</span>
              </a>
            ))}
          </div>
        ) : (
          <p className={styles.empty}>No signed agreements uploaded yet.</p>
        )}
      </div>
    </main>
  );
}
