import Link from "next/link";

import { AddLeadForm } from "@/components/crm/AddLeadForm";
import styles from "@/components/crm/Crm.module.css";
import { AllView, PipelineView, TodayView, WaitingView } from "@/components/crm/CrmViews";
import { buildCrmData } from "@/components/crm/data";
import portal from "@/components/Portal.module.css";
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

const VIEWS = [
  { key: "today", label: "Today" },
  { key: "waiting", label: "Waiting on them" },
  { key: "pipeline", label: "Pipeline" },
  { key: "all", label: "All prospects" },
];

type Params = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

export default async function CrmPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAdminPage();

  const params = await searchParams;
  const requested = one(params.view);
  const view = VIEWS.some((v) => v.key === requested) ? requested : "today";
  const today = todayISO();

  const [leads, units] = await Promise.all([
    getBuyersClient().fetch<Lead[]>(leadsListQuery),
    client.fetch<UnitOption[]>(unitOptionsQuery),
  ]);

  const { meDue, needsStep, them } = buildCrmData(leads, today);
  const counts: Record<string, number> = {
    today: meDue.length + needsStep.length,
    waiting: them.length,
    all: leads.length,
  };

  return (
    <main className={portal.page}>
      <div className={portal.eyebrow}>Admin</div>
      <h1 className={portal.title}>Prospects</h1>

      <AddLeadForm units={units} today={today} />

      <nav className={styles.tabs}>
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={`/admin/crm?view=${v.key}`}
            className={`${styles.tab} ${view === v.key ? styles.tabActive : ""}`}
          >
            {v.label}
            {counts[v.key] !== undefined && counts[v.key] > 0 && (
              <span className={`${styles.badge} ${v.key === "today" ? "" : styles.badgeMuted}`}>
                {counts[v.key]}
              </span>
            )}
          </Link>
        ))}
      </nav>

      {view === "today" && <TodayView leads={leads} today={today} />}
      {view === "waiting" && <WaitingView leads={leads} today={today} />}
      {view === "pipeline" && <PipelineView leads={leads} today={today} />}
      {view === "all" && (
        <AllView
          leads={leads}
          today={today}
          q={one(params.q)}
          stage={one(params.stage)}
          source={one(params.source)}
        />
      )}
    </main>
  );
}
