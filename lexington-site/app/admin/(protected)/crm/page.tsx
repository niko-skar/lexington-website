import styles from "@/components/crm/Crm.module.css";
import { CrmLists } from "@/components/crm/CrmLists";
import { requireAdminPage } from "@/lib/auth/requireAdmin";
import { crmListData } from "@/lib/crmPage";

export const metadata = {
  title: "Prospects | The Lexington",
};

type Params = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

// The lists are shared with the app's Customers part (components/crm/CrmLists.tsx, lib/crmPage.ts, 19 Nov 2026).
export default async function CrmPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAdminPage();

  const params = await searchParams;
  const { leads, units, today, team } = await crmListData();

  return (
    <main className={styles.crmPage}>
      <CrmLists
        leads={leads}
        units={units}
        today={today}
        team={team}
        view={one(params.view)}
        q={one(params.q)}
        stage={one(params.stage)}
        source={one(params.source)}
      />
    </main>
  );
}
