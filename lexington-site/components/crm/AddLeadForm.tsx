"use client";

import Link from "next/link";
import { useActionState } from "react";

import { addLeadAction, type CrmFormState } from "@/lib/actions/crm";
import { SOURCES } from "@/lib/crm";
import type { UnitOption } from "@/lib/sanity/crmTypes";
import styles from "./Crm.module.css";
import { FormMessage, SubmitButton, UnitSelect } from "./FormBits";

const initial: CrmFormState = { status: "idle", message: "" };

// Opened from the "+ Add prospect" button at the top of the screen.
export function AddLeadForm({ units, today }: { units: UnitOption[]; today: string }) {
  const [state, formAction] = useActionState(addLeadAction, initial);

  return (
    <form action={formAction}>
      <div className={styles.formGrid}>
        <div className={styles.field}>
          <label htmlFor="add-name">Name</label>
          <input id="add-name" name="name" required autoComplete="off" autoFocus />
        </div>
        <div className={styles.field}>
          <label htmlFor="add-phone">WhatsApp / phone</label>
          <input id="add-phone" name="phone" type="tel" autoComplete="off" />
        </div>
        <div className={styles.field}>
          <label htmlFor="add-email">Email</label>
          <input id="add-email" name="email" type="email" autoComplete="off" />
        </div>
        <div className={styles.field}>
          <label htmlFor="add-source">Where from</label>
          <select id="add-source" name="source" defaultValue="whatsapp">
            {SOURCES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="add-unit">Unit</label>
          <UnitSelect id="add-unit" name="unitNumber" units={units} />
        </div>
        <div className={styles.field}>
          <label htmlFor="add-next">Next step</label>
          <input id="add-next" name="nextStep" placeholder="e.g. Send floor plans" autoComplete="off" />
        </div>
        <div className={styles.field}>
          <label htmlFor="add-due">Due</label>
          <input id="add-due" name="due" type="date" defaultValue={today} />
        </div>
      </div>
      <SubmitButton pendingText="Adding…">Add prospect</SubmitButton>
      <FormMessage state={state} />
      {state.id && (
        <p className={styles.sectionHint} style={{ marginTop: 8 }}>
          <Link href={`/admin/crm/${state.id}`} className={styles.leadLink}>
            Open {state.status === "success" ? "it" : "their page"} →
          </Link>
        </p>
      )}
    </form>
  );
}
