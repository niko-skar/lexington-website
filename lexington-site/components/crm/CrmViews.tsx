import { firstName } from "@/lib/crm";
import type { CrmTeamMember, Lead } from "@/lib/sanity/crmTypes";
import styles from "./Crm.module.css";
import { LeadLink, useCrmHost } from "./CrmHost";
import { AskNextStepButton } from "./FollowUp";
import { PipelineBoard } from "./PipelineBoard";
import { StageSelect } from "./StageSelect";
import { TaskRow } from "./TaskRow";
import { AssignButton, useAssign } from "./Team";
import { buildCrmData, unitLine, type TaskItem } from "./data";

function Section({
  title,
  hint,
  empty,
  children,
  isEmpty,
}: {
  title: string;
  hint?: string;
  empty: string;
  children: React.ReactNode;
  isEmpty: boolean;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {hint && <span className={styles.sectionHint}>{hint}</span>}
      </div>
      {isEmpty ? <div className={styles.empty}>{empty}</div> : <div className={styles.rows}>{children}</div>}
    </section>
  );
}

function taskRows(items: TaskItem[], today: string, mode: "me" | "them", leaveOnSnooze = false) {
  return items.map(({ lead, task, openCount }) => (
    <TaskRow
      key={`${lead._id}-${task._key}`}
      lead={lead}
      task={task}
      today={today}
      mode={mode}
      leaveOnSnooze={leaveOnSnooze}
      openCount={openCount}
    />
  ));
}

// A prospect with nothing scheduled: open them and add what happens next.
function NeedsStepRow({ lead }: { lead: Lead }) {
  const assign = useAssign(lead);
  if (assign.owner !== assign.saved) return null;
  return (
    <div className={styles.row}>
      <div className={styles.rowMain}>
        <div className={styles.rowTop}>
          <LeadLink id={lead._id} className={styles.leadLink}>
            {lead.name}
          </LeadLink>
          <StageSelect leadId={lead._id} stage={lead.stage} />
        </div>
        <div className={styles.rowMeta}>
          <span>{unitLine(lead)}</span>
          <span>Nothing scheduled</span>
        </div>
        {lead.context && <div className={styles.rowContext}>{lead.context}</div>}
      </div>
      <div className={styles.actions}>
        <AskNextStepButton leadId={lead._id} name={lead.name} />
        <AssignButton assign={assign} />
      </div>
    </div>
  );
}

// ---- Today: everything waiting on the one whose list it is --------------
// The viewer's own list (the office's, or Rahma's when she's signed in), or, for the office, a team member's (`owner`):
// Rahma's list, with what she's waiting on too, since that has no tab of its own there.

export function TodayView({ leads, today, owner }: { leads: Lead[]; today: string; owner?: CrmTeamMember }) {
  const host = useCrmHost();
  const { meDue, meSoon, needsStep, them } = buildCrmData(leads, today);
  const who = owner ? firstName(owner.name) : null;

  return (
    <>
      <Section
        title={who ? `Waiting on ${who}` : "Waiting on you"}
        hint="Overdue first"
        empty={
          who
            ? `Nothing is waiting on ${who} right now. “Give to ${who}” on one of your prospects puts it here.`
            : host.office
              ? "Nothing is waiting on you right now."
              : "Nothing is on your list right now. The prospects you're given show up here."
        }
        isEmpty={meDue.length === 0}
      >
        {taskRows(meDue, today, "me", true)}
      </Section>

      {needsStep.length > 0 && (
        <Section
          title="Needs a next step"
          hint="Open one and add what happens next"
          empty=""
          isEmpty={false}
        >
          {needsStep.map((lead) => (
            <NeedsStepRow key={lead._id} lead={lead} />
          ))}
        </Section>
      )}

      {meSoon.length > 0 && (
        <Section title="Coming up this week" empty="" isEmpty={false}>
          {taskRows(meSoon, today, "me")}
        </Section>
      )}

      {who && them.length > 0 && (
        <Section title={`${who} is waiting on`} hint="Deposits, signed contracts, documents" empty="" isEmpty={false}>
          {taskRows(them, today, "them")}
        </Section>
      )}
    </>
  );
}

// ---- Waiting on them ---------------------------------------------------

export function WaitingView({ leads, today }: { leads: Lead[]; today: string }) {
  const { them } = buildCrmData(leads, today);

  return (
    <Section
      title="You're waiting on"
      hint="Deposits, signed contracts, documents"
      empty="You're not waiting on anyone right now. Add a step on a prospect and choose “Them”."
      isEmpty={them.length === 0}
    >
      {taskRows(them, today, "them")}
    </Section>
  );
}

// ---- Pipeline board ----------------------------------------------------

export function PipelineView({ leads, today }: { leads: Lead[]; today: string }) {
  return <PipelineBoard leads={leads} today={today} />;
}
