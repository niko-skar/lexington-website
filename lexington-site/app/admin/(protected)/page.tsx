import Link from "next/link";

import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { buyerAccountsQuery } from "@/lib/sanity/buyersQueries";
import type { BuyerAccountSummary } from "@/lib/sanity/buyersTypes";
import { CreateBuyerForm } from "@/components/CreateBuyerForm";
import styles from "@/components/Portal.module.css";

export const metadata = {
  title: "Admin | The Lexington",
};

export default async function AdminPage() {
  const buyers = await getBuyersClient().fetch<BuyerAccountSummary[]>(buyerAccountsQuery);

  return (
    <main className={styles.page}>
      <div className={styles.eyebrow}>Admin</div>
      <h1 className={styles.title}>Buyer Accounts</h1>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Create Account</h2>
        <CreateBuyerForm />
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>All Buyers ({buyers.length})</h2>
        {buyers.length > 0 ? (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Unit</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {buyers.map((b) => (
                <tr key={b._id}>
                  <td>{b.email}</td>
                  <td>{b.name}</td>
                  <td>{b.unitNumber}</td>
                  <td>
                    <Link href={`/admin/${b._id}`} style={{ color: "var(--clay)" }}>
                      Reset password
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className={styles.empty}>No buyer accounts yet.</p>
        )}
      </div>

      <p className={styles.empty}>
        Payments, documents and contract price are managed in{" "}
        <Link href="/buyers-studio" style={{ color: "var(--clay)" }}>
          Sanity Studio
        </Link>
        .
      </p>
    </main>
  );
}
