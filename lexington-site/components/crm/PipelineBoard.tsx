"use client";

import Link from "next/link";
import { useOptimistic, useTransition } from "react";

import { setStageAction } from "@/lib/actions/crm";
import { BOARD_STAGES, dueLabel, dueState } from "@/lib/crm";
import type { Lead } from "@/lib/sanity/crmTypes";
import styles from "./Crm.module.css";
import { nextTaskOf, unitLine } from "./data";

const DUE_CLASS = {
  overdue: styles.dueOverdue,
  today: styles.dueToday,
  soon: styles.dueSoon,
  later: styles.dueLater,
  none: styles.dueNone,
};

interface Move {
  id: string;
  stage: string;
}

// The board. A card jumps to its new column the moment you press an arrow;
// the save happens behind it.
export function PipelineBoard({ leads, today }: { leads: Lead[]; today: string }) {
  const [shown, move] = useOptimistic(leads, (current: Lead[], m: Move) =>
    current.map((l) => (l._id === m.id ? { ...l, stage: m.stage } : l))
  );
  const [, startTransition] = useTransition();
  const lostCount = shown.filter((l) => l.stage === "lost").length;

  function go(lead: Lead, stage: string) {
    const from = lead.stage ?? "new";
    startTransition(async () => {
      move({ id: lead._id, stage });
      const data = new FormData();
      data.set("leadId", lead._id);
      data.set("stage", stage);
      data.set("fromStage", from);
      try {
        await setStageAction(data);
      } catch {
        window.alert("Couldn't move that prospect. Please try again.");
      }
    });
  }

  return (
    <>
      <div className={styles.board}>
        {BOARD_STAGES.map((stage, index) => {
          const inStage = shown
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
                          <button
                            type="button"
                            className={styles.btn}
                            aria-label={`Move back to ${prev.label}`}
                            onClick={() => go(lead, prev.key)}
                          >
                            ◀
                          </button>
                        ) : (
                          <span />
                        )}
                        {next ? (
                          <button
                            type="button"
                            className={styles.btn}
                            aria-label={`Move on to ${next.label}`}
                            onClick={() => go(lead, next.key)}
                          >
                            ▶
                          </button>
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
