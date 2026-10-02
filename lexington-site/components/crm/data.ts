import { ACTIVE_STAGES, daysUntil, type StageKey } from "@/lib/crm";
import type { Lead, LeadTask } from "@/lib/sanity/crmTypes";

export interface TaskItem {
  lead: Lead;
  task: LeadTask;
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

// Splits every open task into the lists the screens show. A task with no
// date counts as due today, and one with no "who" counts as waiting on me.
// Prospects marked lost drop out of every list; their steps stay on their own
// page in case they're reopened.
export function buildCrmData(leads: Lead[], today: string) {
  const open: TaskItem[] = leads
    .filter((lead) => lead.stage !== "lost")
    .flatMap((lead) => openTasksOf(lead).map((task) => ({ lead, task })));
  const byDue = (a: TaskItem, b: TaskItem) =>
    (a.task.due ?? today).localeCompare(b.task.due ?? today) || a.lead.name.localeCompare(b.lead.name);

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
