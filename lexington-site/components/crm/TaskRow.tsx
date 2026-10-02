"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";

import { completeTaskAction, deleteTaskAction, snoozeTaskAction } from "@/lib/actions/crm";
import { addDaysISO, daysUntil, dueLabel, dueState, firstName } from "@/lib/crm";
import { phoneHref, whatsappUrl } from "@/lib/format";
import type { Lead, LeadTask } from "@/lib/sanity/crmTypes";
import styles from "./Crm.module.css";
import { StageSelect } from "./StageSelect";

const DUE_CLASS = {
  overdue: styles.dueOverdue,
  today: styles.dueToday,
  soon: styles.dueSoon,
  later: styles.dueLater,
  none: styles.dueNone,
};

interface Shown {
  gone: boolean;
  due?: string;
}

const IDLE: Shown = { gone: false };

// One open task. "me" rows are things Niko owes someone; "them" rows are
// things Niko is waiting to receive (so there's a nudge on WhatsApp).
//
// Buttons update the row straight away and save in the background, so nothing
// feels like it's thinking. If the save fails the row comes back with a message.
export function TaskRow({
  lead,
  task,
  today,
  mode,
  showLead = true,
  leaveOnSnooze = false,
}: {
  lead: Pick<Lead, "_id" | "name" | "phone" | "stage">;
  task: LeadTask;
  today: string;
  mode: "me" | "them";
  showLead?: boolean;
  /** In the "waiting on you" list a snoozed step drops out of the list. */
  leaveOnSnooze?: boolean;
}) {
  const [shown, show] = useOptimistic(IDLE, (_current: Shown, next: Shown) => next);
  const [, startTransition] = useTransition();
  const [error, setError] = useState("");

  if (shown.gone) return null;

  const due = shown.due ?? task.due;
  const state = dueState(due, today);
  const since = (task.createdAt ?? task.due ?? today).slice(0, 10);
  const waited = Math.max(0, -daysUntil(since, today));
  const nudge = `Hi ${firstName(lead.name)}, a quick follow-up from The Lexington about: ${task.text}. Let me know if there's anything you need from me.`;

  function run(action: (data: FormData) => Promise<void>, fields: Record<string, string>, next: Shown) {
    setError("");
    startTransition(async () => {
      show(next);
      const data = new FormData();
      data.set("leadId", lead._id);
      data.set("taskKey", task._key);
      for (const [key, value] of Object.entries(fields)) data.set(key, value);
      try {
        await action(data);
      } catch {
        setError("Couldn't save that. Please try again.");
      }
    });
  }

  const snooze = (days: number) =>
    run(snoozeTaskAction, { days: String(days) }, leaveOnSnooze ? { gone: true } : { gone: false, due: addDaysISO(today, days) });

  return (
    <div className={`${styles.row} ${state === "overdue" ? styles.rowOverdue : ""}`}>
      <div className={styles.rowMain}>
        {showLead && (
          <div className={styles.rowTop}>
            <Link href={`/admin/crm/${lead._id}`} className={styles.leadLink}>
              {lead.name}
            </Link>
            <StageSelect leadId={lead._id} stage={lead.stage} />
          </div>
        )}
        <div className={styles.rowText}>{task.text}</div>
        <div className={styles.rowMeta}>
          <span className={DUE_CLASS[state]}>{dueLabel(due, today)}</span>
          {mode === "them" && <span>Waiting {waited === 0 ? "since today" : `${waited} day${waited === 1 ? "" : "s"}`}</span>}
        </div>
        {error && <p className={styles.formMsgErr}>{error}</p>}
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.btnDone}
          onClick={() => run(completeTaskAction, { taskText: task.text }, { gone: true })}
        >
          Done
        </button>
        <button type="button" className={styles.btn} onClick={() => snooze(1)}>
          Tomorrow
        </button>
        <button type="button" className={styles.btn} onClick={() => snooze(3)}>
          +3 days
        </button>
        {lead.phone && (
          <>
            <a
              className={styles.btn}
              href={whatsappUrl(lead.phone, mode === "them" ? nudge : undefined)}
              target="_blank"
              rel="noreferrer"
            >
              WhatsApp
            </a>
            <a className={styles.btn} href={phoneHref(lead.phone)}>
              Call
            </a>
          </>
        )}
        {!showLead && (
          <button
            type="button"
            className={styles.btn}
            onClick={() => {
              if (window.confirm("Remove this step?")) run(deleteTaskAction, {}, { gone: true });
            }}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
