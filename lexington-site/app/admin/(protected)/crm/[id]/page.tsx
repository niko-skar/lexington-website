import { notFound } from "next/navigation";

import styles from "@/components/crm/Crm.module.css";
import { ProspectView } from "@/components/crm/ProspectView";
import { requireAdminPage } from "@/lib/auth/requireAdmin";
import { prospectData } from "@/lib/crmPage";

export const metadata = {
  title: "Prospect | The Lexington",
};

// "Write a suggested reply" runs here and can wait up to a minute for Claude.
export const maxDuration = 120;

// The screen is shared with the app's Customers part (components/crm/ProspectView.tsx, lib/crmPage.ts, 19 Nov 2026).
export default async function ProspectPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();

  const { id } = await params;
  const data = await prospectData(id);
  if (!data) notFound();

  return (
    <main className={styles.crmPage}>
      <ProspectView data={data} />
    </main>
  );
}
