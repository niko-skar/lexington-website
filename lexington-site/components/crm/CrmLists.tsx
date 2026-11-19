"use client";

import type { Lead, UnitOption } from "@/lib/sanity/crmTypes";
import { AddLeadForm } from "./AddLeadForm";
import { AllView } from "./AllView";
import { CrmTabs } from "./CrmTabs";
import { PipelineView, TodayView, WaitingView } from "./CrmViews";
import { buildCrmData } from "./data";

export const CRM_VIEWS = ["today", "waiting", "pipeline", "all"];

// The prospects' lists: Today, Waiting on them, the Pipeline and All prospects, with the search and "+ Add prospect" on
// top. The admin page (/admin/crm) and the app's Customers part draw the same lists (19 Nov 2026).
export function CrmLists({
  leads,
  units,
  today,
  view,
  q = "",
  stage = "",
  source = "",
  title,
}: {
  leads: Lead[];
  units: UnitOption[];
  today: string;
  view: string;
  q?: string;
  stage?: string;
  source?: string;
  /** None in the app, where the header above says it. */
  title?: string | null;
}) {
  const { meDue, needsStep, them } = buildCrmData(leads, today);

  return (
    <CrmTabs
      initial={CRM_VIEWS.includes(view) ? view : "today"}
      today={today}
      title={title}
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
          content: <AllView leads={leads} today={today} q={q} stage={stage} source={source} />,
        },
      ]}
    />
  );
}
