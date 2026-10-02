import Link from "next/link";

import {
  completeTaskAction,
  deleteTaskAction,
  snoozeTaskAction,
} from "@/lib/actions/crm";
import { daysUntil, dueLabel, dueState, firstName } from "@/lib/crm";
import { phoneHref, whatsappUrl } from "@/lib/format";
import type { Lead, LeadTask } from "@/lib/sanity/crmTypes";
import { ConfirmSubmitButton } from "./ConfirmSubmitButton";
import styles from "./Crm.module.css";
import { StageChip } from "./StageChip";

const DUE_CLASS = {
  overdue: styles.dueOverdue,
  today: styles.dueToday,
  soon: styles.dueSoon,
  later: styles.dueLater,
  none: styles.dueNone,
};

// One open task. "me" rows are things Niko owes someone; "them" rows are
// things Niko is waiting to receive (so there's a nudge on WhatsApp).
export function TaskRow({
  lead,
  task,
  today,
  mode,
  showLead = true,
}: {
  lead: Pick<Lead, "_id" | "name" | "phone" | "stage">;
  task: LeadTask;
  today: string;
  mode: "me" | "them";
  showLead?: boolean;
}) {
  const state = dueState(task.due, today);
  const since = (task.createdAt ?? task.due ?? today).slice(0, 10);
  const waited = Math.max(0, -daysUntil(since, today));
  const nudge = `Hi ${firstName(lead.name)}, a quick follow-up from The Lexington about: ${task.text}. Let me know if there's anything you need from me.`;

  return (
    <div className={`${styles.row} ${state === "overdue" ? styles.rowOverdue : ""}`}>
      <div className={styles.rowMain}>
        {showLead && (
          <div className={styles.rowTop}>
            <Link href={`/admin/crm/${lead._id}`} className={styles.leadLink}>
              {lead.name}
            </Link>
            <StageChip stage={lead.stage} />
          </div>
        )}
        <div className={styles.rowText}>{task.text}</div>
        <div className={styles.rowMeta}>
          <span className={DUE_CLASS[state]}>{dueLabel(task.due, today)}</span>
          {mode === "them" && <span>Waiting {waited === 0 ? "since today" : `${waited} day${waited === 1 ? "" : "s"}`}</span>}
        </div>
      </div>

      <div className={styles.actions}>
        <form action={completeTaskAction}>
          <input type="hidden" name="leadId" value={lead._id} />
          <input type="hidden" name="taskKey" value={task._key} />
          <input type="hidden" name="taskText" value={task.text} />
          <button type="submit" className={styles.btnDone}>
            Done
          </button>
        </form>
        <form action={snoozeTaskAction}>
          <input type="hidden" name="leadId" value={lead._id} />
          <input type="hidden" name="taskKey" value={task._key} />
          <input type="hidden" name="days" value="1" />
          <button type="submit" className={styles.btn}>
            Tomorrow
          </button>
        </form>
        <form action={snoozeTaskAction}>
          <input type="hidden" name="leadId" value={lead._id} />
          <input type="hidden" name="taskKey" value={task._key} />
          <input type="hidden" name="days" value="3" />
          <button type="submit" className={styles.btn}>
            +3 days
          </button>
        </form>
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
          <form action={deleteTaskAction}>
            <input type="hidden" name="leadId" value={lead._id} />
            <input type="hidden" name="taskKey" value={task._key} />
            <ConfirmSubmitButton message="Remove this step?" className={styles.btn}>
              Remove
            </ConfirmSubmitButton>
          </form>
        )}
      </div>
    </div>
  );
}
