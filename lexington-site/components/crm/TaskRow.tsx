"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";

import {
  completeTaskAction,
  deleteTaskAction,
  reopenTaskAction,
  setTaskDueAction,
  snoozeTaskAction,
} from "@/lib/actions/crm";
import { addDaysISO, daysUntil, dueLabel, dueState, firstName } from "@/lib/crm";
import { phoneHref, whatsappUrl } from "@/lib/format";
import type { Lead, LeadTask } from "@/lib/sanity/crmTypes";
import styles from "./Crm.module.css";
import { useFollowUp } from "./FollowUp";
import { StageSelect } from "./StageSelect";
import { useToast } from "./Toasts";
import { aboutLine } from "./data";

const DUE_CLASS = {
  overdue: styles.dueOverdue,
  today: styles.dueToday,
  soon: styles.dueSoon,
  later: styles.dueLater,
  none: styles.dueNone,
};

// Finished or gone prospects don't need a "what's next?".
const NO_FOLLOW_UP = ["paid", "handed_over", "lost"];

interface Shown {
  gone: boolean;
  due?: string;
}

const IDLE: Shown = { gone: false };

type RowLead = Pick<Lead, "_id" | "name" | "phone" | "stage" | "interest" | "unitNumber" | "paymentPreference" | "context">;

// One open task. "me" rows are things Niko owes someone; "them" rows are
// things Niko is waiting to receive (so there's a nudge on WhatsApp).
//
// Buttons update the row straight away and save in the background. Each one
// leaves an Undo behind for a few seconds, and if the failure case ever
// happens the row comes back with a message.
export function TaskRow({
  lead,
  task,
  today,
  mode,
  showLead = true,
  leaveOnSnooze = false,
  openCount = 2,
}: {
  lead: RowLead;
  task: LeadTask;
  today: string;
  mode: "me" | "them";
  showLead?: boolean;
  /** In the "waiting on you" list a snoozed step drops out of the list. */
  leaveOnSnooze?: boolean;
  /** How many open steps the prospect has, this one included. */
  openCount?: number;
}) {
  const [shown, show] = useOptimistic(IDLE, (_current: Shown, next: Shown) => next);
  const [, startTransition] = useTransition();
  const [error, setError] = useState("");
  const toast = useToast();
  const followUp = useFollowUp();

  if (shown.gone) return null;

  const due = shown.due ?? task.due;
  const state = dueState(due, today);
  const since = (task.createdAt ?? task.due ?? today).slice(0, 10);
  const waited = Math.max(0, -daysUntil(since, today));
  const nudge = `Hi ${firstName(lead.name)}, a quick follow-up from The Lexington about: ${task.text}. Let me know if there's anything you need from me.`;
  const about = aboutLine(lead);

  // Runs one of the saving actions in the background; resolves with what it
  // returned (undefined if it failed).
  function run<T>(
    action: (data: FormData) => Promise<T>,
    fields: Record<string, string>,
    next: Shown
  ): Promise<T | undefined> {
    setError("");
    return new Promise((resolve) => {
      startTransition(async () => {
        show(next);
        const data = new FormData();
        data.set("leadId", lead._id);
        data.set("taskKey", task._key);
        for (const [key, value] of Object.entries(fields)) data.set(key, value);
        try {
          resolve(await action(data));
        } catch {
          setError("Couldn't save that. Please try again.");
          resolve(undefined);
        }
      });
    });
  }

  function markDone() {
    const result = run(completeTaskAction, { taskText: task.text }, { gone: true });
    toast.show(`Done: ${task.text}`, async () => {
      const done = await result;
      if (!done) return;
      const data = new FormData();
      data.set("leadId", lead._id);
      data.set("taskKey", task._key);
      data.set("noteKey", done.noteKey);
      await reopenTaskAction(data);
    });
    if (showLead && followUp && openCount <= 1 && !NO_FOLLOW_UP.includes(lead.stage)) {
      followUp.ask({ leadId: lead._id, name: lead.name });
    }
  }

  function snooze(days: number) {
    const previous = task.due ?? "";
    void run(snoozeTaskAction, { days: String(days) }, leaveOnSnooze ? { gone: true } : { gone: false, due: addDaysISO(today, days) });
    toast.show(`Moved to ${days === 1 ? "tomorrow" : `in ${days} days`}: ${task.text}`, async () => {
      const data = new FormData();
      data.set("leadId", lead._id);
      data.set("taskKey", task._key);
      data.set("due", previous);
      await setTaskDueAction(data);
    });
  }

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
        {showLead && about && <div className={styles.rowAbout}>{about}</div>}
        {showLead && lead.context && <div className={styles.rowContext}>{lead.context}</div>}
        {error && <p className={styles.formMsgErr}>{error}</p>}
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.btnDone} onClick={markDone}>
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
              if (window.confirm("Remove this step?")) void run(deleteTaskAction, {}, { gone: true });
            }}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
