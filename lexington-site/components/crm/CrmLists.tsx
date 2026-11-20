"use client";

import { firstName } from "@/lib/crm";
import type { CrmTeamMember, Lead, UnitOption } from "@/lib/sanity/crmTypes";
import { AddLeadForm } from "./AddLeadForm";
import { AllView } from "./AllView";
import { useCrmHost } from "./CrmHost";
import { CrmTabs, type CrmTab } from "./CrmTabs";
import { PipelineView, TodayView, WaitingView } from "./CrmViews";
import { TeamProvider } from "./Team";
import { buildCrmData, ownerOf } from "./data";

/** A team member's list, as a tab of the office's (its key, also the address's ?view=). */
export const teamView = (id: string) => `team-${id}`;

// The prospects' lists: Today, Waiting on them, the Pipeline and All prospects, with the search and "+ Add prospect" on
// top. The admin page (/admin/crm) and the app's Customers part draw the same lists (19 Nov 2026).
//
// Today and Waiting on them are the viewer's own list (20 Nov 2026): the office's is everything not given to someone
// (Rahma), hers is what was given to her. The office also gets a tab for each one's list ("Rahma's list"), to keep an eye
// on it and take one back. The Pipeline and All prospects show everyone, marked with whose list they're on.
export function CrmLists({
  leads,
  units,
  today,
  team = [],
  view,
  q = "",
  stage = "",
  source = "",
  title,
}: {
  leads: Lead[];
  units: UnitOption[];
  today: string;
  team?: CrmTeamMember[];
  view: string;
  q?: string;
  stage?: string;
  source?: string;
  /** None in the app, where the header above says it. */
  title?: string | null;
}) {
  const host = useCrmHost();
  const viewer = host.office ? "" : (host.me ?? "");
  const mine = leads.filter((l) => ownerOf(l, team) === viewer);
  const { meDue, needsStep, them } = buildCrmData(mine, today);

  const theirLists: CrmTab[] = host.office
    ? team.map((member) => {
        const theirs = leads.filter((l) => ownerOf(l, team) === member.id);
        const counts = buildCrmData(theirs, today);
        return {
          key: teamView(member.id),
          label: `${firstName(member.name)}'s list`,
          count: counts.meDue.length + counts.needsStep.length,
          muted: true,
          content: <TodayView leads={theirs} today={today} owner={member} />,
        };
      })
    : [];

  const tabs: CrmTab[] = [
    {
      key: "today",
      label: "Today",
      count: meDue.length + needsStep.length,
      content: <TodayView leads={mine} today={today} />,
    },
    {
      key: "waiting",
      label: "Waiting on them",
      count: them.length,
      muted: true,
      content: <WaitingView leads={mine} today={today} />,
    },
    ...theirLists,
    { key: "pipeline", label: "Pipeline", content: <PipelineView leads={leads} today={today} /> },
    {
      key: "all",
      label: "All prospects",
      count: leads.length,
      muted: true,
      content: <AllView leads={leads} today={today} q={q} stage={stage} source={source} />,
    },
  ];

  return (
    <TeamProvider team={team}>
      <CrmTabs
        initial={tabs.some((t) => t.key === view) ? view : "today"}
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
        tabs={tabs}
      />
    </TeamProvider>
  );
}
