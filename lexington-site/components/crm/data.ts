import { ACTIVE_STAGES, STAGES, daysUntil, paymentLabel, type StageKey } from "@/lib/crm";
import type { Lead, LeadTask } from "@/lib/sanity/crmTypes";

export interface TaskItem {
  lead: Lead;
  task: LeadTask;
  /** How many open steps this prospect has in all, this one included. */
  openCount: number;
}

export function unitLine(lead: Pick<Lead, "unitNumber" | "interest">) {
  return lead.unitNumber ? `Unit ${lead.unitNumber}` : lead.interest || "No unit yet";
}

// What a row says about the person, so there is no need to open them to know who
// they are: the unit and what they asked about, and how they plan to pay.
export function aboutLine(lead: Pick<Lead, "unitNumber" | "interest" | "paymentPreference">) {
  return [
    lead.unitNumber ? `Unit ${lead.unitNumber}` : "",
    lead.interest ?? "",
    lead.paymentPreference && lead.paymentPreference !== "undecided" ? paymentLabel(lead.paymentPreference) : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function openTasksOf(lead: Lead): LeadTask[] {
  return (lead.tasks ?? []).filter((t) => !t.done);
}

// The soonest open task, used as a prospect's "next step" in lists.
export function nextTaskOf(lead: Lead, today: string): LeadTask | undefined {
  return [...openTasksOf(lead)].sort((a, b) =>
    (a.due ?? today).localeCompare(b.due ?? today)
  )[0];
}

// How far along a prospect is; further along sorts first when dates tie.
const stageRank = (stage: string) => STAGES.findIndex((s) => s.key === stage);

// Splits every open task into the lists the screens show. A task with no
// date counts as due today, and one with no "who" counts as waiting on me.
// Prospects marked lost drop out of every list; their steps stay on their own
// page in case they're reopened.
//
// Oldest date first; on the same day the prospect who is furthest along comes
// first (someone with a contract out before someone who just got in touch).
export function buildCrmData(leads: Lead[], today: string) {
  const open: TaskItem[] = leads
    .filter((lead) => lead.stage !== "lost")
    .flatMap((lead) => {
      const tasks = openTasksOf(lead);
      return tasks.map((task) => ({ lead, task, openCount: tasks.length }));
    });
  const byDue = (a: TaskItem, b: TaskItem) =>
    (a.task.due ?? today).localeCompare(b.task.due ?? today) ||
    stageRank(b.lead.stage) - stageRank(a.lead.stage) ||
    a.lead.name.localeCompare(b.lead.name);

  const mine = open.filter((r) => r.task.waitingOn !== "them");
  const meDue = mine.filter((r) => daysUntil(r.task.due ?? today, today) <= 0).sort(byDue);
  const meSoon = mine
    .filter((r) => {
      const d = daysUntil(r.task.due ?? today, today);
      return d > 0 && d <= 7;
    })
    .sort(byDue);
  const them = open.filter((r) => r.task.waitingOn === "them").sort(byDue);
  const needsStep = leads.filter(
    (l) => ACTIVE_STAGES.includes(l.stage as StageKey) && openTasksOf(l).length === 0
  );

  return { meDue, meSoon, them, needsStep };
}
