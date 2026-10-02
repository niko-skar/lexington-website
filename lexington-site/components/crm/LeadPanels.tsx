"use client";

import { useOptimistic, useRef, useState } from "react";

import { addNoteAction, addTaskAction, type CrmFormState } from "@/lib/actions/crm";
import { dueLabel, formatWhen } from "@/lib/crm";
import type { Lead, LeadNote, LeadTask } from "@/lib/sanity/crmTypes";
import styles from "./Crm.module.css";
import { FormMessage, SubmitButton } from "./FormBits";
import { TaskRow } from "./TaskRow";

const idle: CrmFormState = { status: "idle", message: "" };
const isPending = (key: string) => key.startsWith("pending-");

// ---- next steps ----------------------------------------------------------

// A new step shows up the moment it's added and is saved behind the scenes.
export function StepsPanel({
  lead,
  open,
  done,
  today,
}: {
  lead: Lead;
  open: LeadTask[];
  done: LeadTask[];
  today: string;
}) {
  const [steps, addStep] = useOptimistic(open, (current: LeadTask[], step: LeadTask) => [...current, step]);
  const [state, setState] = useState<CrmFormState>(idle);
  const form = useRef<HTMLFormElement | null>(null);

  async function add(data: FormData) {
    const text = String(data.get("text") || "").trim();
    if (!text) return;
    const due = String(data.get("due") || "") || today;
    const waitingOn = data.get("waitingOn") === "them" ? "them" : "me";

    setState(idle);
    addStep({ _key: `pending-${text}`, text, due, waitingOn, done: false });
    form.current?.reset();
    const result = await addTaskAction(idle, data);
    // The step is already on screen, so only a failure needs saying.
    setState(result.status === "error" ? result : idle);
  }

  return (
    <>
      {steps.length === 0 ? (
        <div className={styles.empty}>Nothing scheduled. Add the next step below.</div>
      ) : (
        <div className={styles.rows} style={{ marginBottom: 18 }}>
          {steps.map((task) =>
            isPending(task._key) ? (
              <div key={task._key} className={styles.row}>
                <div className={styles.rowMain}>
                  <div className={styles.rowText}>{task.text}</div>
                  <div className={styles.rowMeta}>
                    <span>{dueLabel(task.due, today)}</span>
                    <span>Saving…</span>
                  </div>
                </div>
              </div>
            ) : (
              <TaskRow
                key={task._key}
                lead={lead}
                task={task}
                today={today}
                mode={task.waitingOn === "them" ? "them" : "me"}
                showLead={false}
              />
            )
          )}
        </div>
      )}

      <form ref={form} action={add}>
        <input type="hidden" name="leadId" value={lead._id} />
        <div className={styles.formGrid}>
          <div className={styles.field} style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="t-text">Next step</label>
            <input id="t-text" name="text" required placeholder="e.g. Send the contract" autoComplete="off" />
          </div>
          <div className={styles.field}>
            <label htmlFor="t-due">Due</label>
            <input id="t-due" name="due" type="date" defaultValue={today} />
          </div>
          <div className={styles.field}>
            <label htmlFor="t-who">Who has to act</label>
            <select id="t-who" name="waitingOn" defaultValue="me">
              <option value="me">Me</option>
              <option value="them">Them (I&apos;m waiting)</option>
            </select>
          </div>
        </div>
        <SubmitButton pendingText="Adding…">Add step</SubmitButton>
        <FormMessage state={state} />
      </form>

      {done.length > 0 && (
        <details className={styles.doneList}>
          <summary>Done ({done.length})</summary>
          {done.map((t) => (
            <div key={t._key} className={styles.doneItem}>
              {t.text}
            </div>
          ))}
        </details>
      )}
    </>
  );
}

// ---- notes ---------------------------------------------------------------

// A new note appears at the top as soon as it's added.
export function NotesPanel({ leadId, notes }: { leadId: string; notes: LeadNote[] }) {
  const [shown, addNote] = useOptimistic(notes, (current: LeadNote[], note: LeadNote) => [note, ...current]);
  const [state, setState] = useState<CrmFormState>(idle);
  const form = useRef<HTMLFormElement | null>(null);

  async function add(data: FormData) {
    const text = String(data.get("text") || "").trim();
    if (!text) return;

    setState(idle);
    addNote({ _key: `pending-${text}`, at: new Date().toISOString(), kind: "note", text });
    form.current?.reset();
    const result = await addNoteAction(idle, data);
    setState(result.status === "error" ? result : idle);
  }

  return (
    <>
      <form ref={form} action={add}>
        <input type="hidden" name="leadId" value={leadId} />
        <div className={styles.field} style={{ marginBottom: 12 }}>
          <label htmlFor="n-text">Add a note</label>
          <textarea id="n-text" name="text" required placeholder="What was said, what they want…" />
        </div>
        <SubmitButton pendingText="Adding…">Add note</SubmitButton>
        <FormMessage state={state} />
      </form>

      <div className={styles.noteList}>
        {shown.map((n) => (
          <div key={n._key} className={`${styles.noteItem} ${n.kind !== "note" ? styles.noteSystem : ""}`}>
            <div className={styles.noteMeta}>{isPending(n._key) ? "Saving…" : formatWhen(n.at)}</div>
            {n.text}
          </div>
        ))}
        {shown.length === 0 && <div className={styles.empty}>No notes yet.</div>}
      </div>
    </>
  );
}
