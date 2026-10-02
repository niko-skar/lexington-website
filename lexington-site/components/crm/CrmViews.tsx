import Link from "next/link";

import { setStageAction } from "@/lib/actions/crm";
import {
  BOARD_STAGES,
  SOURCES,
  STAGES,
  dueLabel,
  dueState,
  paymentLabel,
  sourceLabel,
} from "@/lib/crm";
import { phoneHref, whatsappUrl } from "@/lib/format";
import type { Lead } from "@/lib/sanity/crmTypes";
import styles from "./Crm.module.css";
import { StageChip } from "./StageChip";
import { TaskRow } from "./TaskRow";
import { buildCrmData, nextTaskOf, type TaskItem } from "./data";

const DUE_CLASS = {
  overdue: styles.dueOverdue,
  today: styles.dueToday,
  soon: styles.dueSoon,
  later: styles.dueLater,
  none: styles.dueNone,
};

function unitLine(lead: Lead) {
  return lead.unitNumber ? `Unit ${lead.unitNumber}` : lead.interest || "No unit yet";
}

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

function taskRows(items: TaskItem[], today: string, mode: "me" | "them") {
  return items.map(({ lead, task }) => (
    <TaskRow key={`${lead._id}-${task._key}`} lead={lead} task={task} today={today} mode={mode} />
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
        {taskRows(meDue, today, "me")}
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
                  <StageChip stage={lead.stage} />
                </div>
                <div className={styles.rowMeta}>
                  <span>{unitLine(lead)}</span>
                  <span>Nothing scheduled</span>
                </div>
              </div>
              <div className={styles.actions}>
                <Link href={`/admin/crm/${lead._id}`} className={styles.btnPrimary}>
                  Add next step
                </Link>
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
  const lostCount = leads.filter((l) => l.stage === "lost").length;

  return (
    <>
      <div className={styles.board}>
        {BOARD_STAGES.map((stage, index) => {
          const inStage = leads
            .filter((l) => l.stage === stage.key)
            .sort((a, b) =>
              (nextTaskOf(a, today)?.due ?? "9999").localeCompare(nextTaskOf(b, today)?.due ?? "9999")
            );
          const prev = BOARD_STAGES[index - 1];
          const next = BOARD_STAGES[index + 1];

          return (
            <div key={stage.key} className={styles.col}>
              <div className={styles.colHead}>
                <span>{stage.label}</span>
                <span className={`${styles.badge} ${styles.badgeMuted}`}>{inStage.length}</span>
              </div>
              <div className={styles.cards}>
                {inStage.map((lead) => {
                  const task = nextTaskOf(lead, today);
                  return (
                    <div key={lead._id} className={styles.card}>
                      <Link href={`/admin/crm/${lead._id}`} className={styles.cardName}>
                        {lead.name}
                      </Link>
                      <div className={styles.cardSub}>{unitLine(lead)}</div>
                      {task ? (
                        <div className={styles.cardTask}>
                          {task.text}{" "}
                          <span className={DUE_CLASS[dueState(task.due, today)]}>
                            · {dueLabel(task.due, today)}
                          </span>
                        </div>
                      ) : (
                        <div className={`${styles.cardTask} ${styles.dueOverdue}`}>No next step</div>
                      )}
                      <div className={styles.cardNav}>
                        {prev ? (
                          <form action={setStageAction}>
                            <input type="hidden" name="leadId" value={lead._id} />
                            <input type="hidden" name="stage" value={prev.key} />
                            <button type="submit" className={styles.btn} aria-label={`Move back to ${prev.label}`}>
                              ◀
                            </button>
                          </form>
                        ) : (
                          <span />
                        )}
                        {next ? (
                          <form action={setStageAction}>
                            <input type="hidden" name="leadId" value={lead._id} />
                            <input type="hidden" name="stage" value={next.key} />
                            <button type="submit" className={styles.btn} aria-label={`Move on to ${next.label}`}>
                              ▶
                            </button>
                          </form>
                        ) : (
                          <span />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {lostCount > 0 && (
        <Link href="/admin/crm?view=all&stage=lost" className={styles.lostLink}>
          Lost ({lostCount})
        </Link>
      )}
    </>
  );
}

// ---- All prospects (search + filter) -----------------------------------

export function AllView({
  leads,
  today,
  q,
  stage,
  source,
}: {
  leads: Lead[];
  today: string;
  q: string;
  stage: string;
  source: string;
}) {
  const needle = q.toLowerCase();
  const shown = leads.filter((l) => {
    if (stage && l.stage !== stage) return false;
    if (source && l.source !== source) return false;
    if (!needle) return true;
    return [l.name, l.email, l.phone, l.unitNumber, l.interest]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(needle));
  });

  return (
    <>
      <form method="get" action="/admin/crm" className={styles.filters}>
        <input type="hidden" name="view" value="all" />
        <div className={styles.field}>
          <label htmlFor="q">Search</label>
          <input id="q" name="q" defaultValue={q} placeholder="Name, phone, email or unit" />
        </div>
        <div className={styles.field}>
          <label htmlFor="stage">Stage</label>
          <select id="stage" name="stage" defaultValue={stage}>
            <option value="">All stages</option>
            {STAGES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="source">Where from</label>
          <select id="source" name="source" defaultValue={source}>
            <option value="">Anywhere</option>
            {SOURCES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={styles.btnPrimary}>
          Filter
        </button>
      </form>

      <div className={styles.sectionHead}>
        <span className={styles.sectionHint}>
          {shown.length} of {leads.length} prospects
        </span>
      </div>

      {shown.length === 0 ? (
        <div className={styles.empty}>No prospects match.</div>
      ) : (
        <div className={styles.rows}>
          {shown.map((lead) => {
            const task = lead.stage === "lost" ? undefined : nextTaskOf(lead, today);
            return (
              <div key={lead._id} className={styles.row}>
                <div className={styles.rowMain}>
                  <div className={styles.rowTop}>
                    <Link href={`/admin/crm/${lead._id}`} className={styles.leadLink}>
                      {lead.name}
                    </Link>
                    <StageChip stage={lead.stage} />
                  </div>
                  <div className={styles.rowMeta}>
                    <span>{unitLine(lead)}</span>
                    <span>{sourceLabel(lead.source)}</span>
                    <span>{paymentLabel(lead.paymentPreference)}</span>
                  </div>
                  {task && (
                    <div className={styles.rowText}>
                      {task.text}{" "}
                      <span className={DUE_CLASS[dueState(task.due, today)]}>
                        · {dueLabel(task.due, today)}
                        {task.waitingOn === "them" ? " (waiting on them)" : ""}
                      </span>
                    </div>
                  )}
                </div>
                <div className={styles.actions}>
                  {lead.phone && (
                    <>
                      <a className={styles.btn} href={whatsappUrl(lead.phone)} target="_blank" rel="noreferrer">
                        WhatsApp
                      </a>
                      <a className={styles.btn} href={phoneHref(lead.phone)}>
                        Call
                      </a>
                    </>
                  )}
                  <Link href={`/admin/crm/${lead._id}`} className={styles.btn}>
                    Open
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
