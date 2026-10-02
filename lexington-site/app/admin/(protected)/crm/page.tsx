import { AddLeadForm } from "@/components/crm/AddLeadForm";
import { AllView } from "@/components/crm/AllView";
import styles from "@/components/crm/Crm.module.css";
import { CrmTabs } from "@/components/crm/CrmTabs";
import { PipelineView, TodayView, WaitingView } from "@/components/crm/CrmViews";
import { buildCrmData } from "@/components/crm/data";
import { todayISO } from "@/lib/crm";
import { requireAdminPage } from "@/lib/auth/requireAdmin";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { client } from "@/lib/sanity/client";
import { leadsListQuery } from "@/lib/sanity/crmQueries";
import type { Lead, UnitOption } from "@/lib/sanity/crmTypes";
import { unitOptionsQuery } from "@/lib/sanity/queries";

export const metadata = {
  title: "Prospects | The Lexington",
};

const VIEWS = ["today", "waiting", "pipeline", "all"];

type Params = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

export default async function CrmPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAdminPage();

  const params = await searchParams;
  const requested = one(params.view);
  const view = VIEWS.includes(requested) ? requested : "today";
  const today = todayISO();

  // The unit list barely changes, so it's kept for a few minutes instead of
  // being fetched on every click.
  const [leads, units] = await Promise.all([
    getBuyersClient().fetch<Lead[]>(leadsListQuery),
    client.fetch<UnitOption[]>(unitOptionsQuery, {}, { next: { revalidate: 300 } }),
  ]);

  const { meDue, needsStep, them } = buildCrmData(leads, today);

  return (
    <main className={styles.crmPage}>
      <CrmTabs
        initial={view}
        today={today}
        search={leads.map((l) => ({
          id: l._id,
          name: l.name,
          stage: l.stage,
          phone: l.phone,
          email: l.email,
          unitNumber: l.unitNumber,
          interest: l.interest,
        }))}
        addForm={<AddLeadForm units={units} today={today} />}
        tabs={[
          {
            key: "today",
            label: "Today",
            count: meDue.length + needsStep.length,
            content: <TodayView leads={leads} today={today} />,
          },
          {
            key: "waiting",
            label: "Waiting on them",
            count: them.length,
            muted: true,
            content: <WaitingView leads={leads} today={today} />,
          },
          { key: "pipeline", label: "Pipeline", content: <PipelineView leads={leads} today={today} /> },
          {
            key: "all",
            label: "All prospects",
            count: leads.length,
            muted: true,
            content: (
              <AllView
                leads={leads}
                today={today}
                q={one(params.q)}
                stage={one(params.stage)}
                source={one(params.source)}
              />
            ),
          },
        ]}
      />
    </main>
  );
}
