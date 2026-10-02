import Link from "next/link";

import type { Lead } from "@/lib/sanity/crmTypes";
import styles from "./Crm.module.css";
import { AskNextStepButton } from "./FollowUp";
import { PipelineBoard } from "./PipelineBoard";
import { StageSelect } from "./StageSelect";
import { TaskRow } from "./TaskRow";
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

// ---- Today: everything waiting on Niko --------------------------------

export function TodayView({ leads, today }: { leads: Lead[]; today: string }) {
  const { meDue, meSoon, needsStep } = buildCrmData(leads, today);

  return (
    <>
      <Section
        title="Waiting on you"
        hint="Overdue first"
        empty="Nothing is waiting on you right now."
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
            <div key={lead._id} className={styles.row}>
              <div className={styles.rowMain}>
                <div className={styles.rowTop}>
                  <Link href={`/admin/crm/${lead._id}`} className={styles.leadLink}>
                    {lead.name}
                  </Link>
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
              </div>
            </div>
          ))}
        </Section>
      )}

      {meSoon.length > 0 && (
        <Section title="Coming up this week" empty="" isEmpty={false}>
          {taskRows(meSoon, today, "me")}
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
