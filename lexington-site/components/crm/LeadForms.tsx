"use client";

import Link from "next/link";
import { useActionState } from "react";

import { createBuyerFromLeadAction, updateLeadAction, type CrmFormState } from "@/lib/actions/crm";
import { PAYMENT_PREFS, SOURCES } from "@/lib/crm";
import type { Lead, UnitOption } from "@/lib/sanity/crmTypes";
import styles from "./Crm.module.css";
import { FormMessage, SubmitButton, UnitSelect } from "./FormBits";

const initial: CrmFormState = { status: "idle", message: "" };

// ---- edit details ------------------------------------------------------

export function LeadDetailsForm({ lead, units }: { lead: Lead; units: UnitOption[] }) {
  const [state, formAction] = useActionState(updateLeadAction, initial);

  // React resets a form after its action runs, and a <select> keeps its
  // *first* default forever -- so after a save the dropdowns would snap back to
  // the old choices, and the next save would quietly put them back. Re-keying
  // the fields on the saved values gives them fresh defaults every time.
  const savedKey = [
    lead.name,
    lead.phone,
    lead.email,
    lead.source,
    lead.unitNumber,
    lead.interest,
    lead.paymentPreference,
    lead.agreedPriceUSD,
  ].join("|");

  return (
    <form action={formAction}>
      <input type="hidden" name="leadId" value={lead._id} />
      <div key={savedKey} className={styles.formGrid}>
        <div className={styles.field}>
          <label htmlFor="d-name">Name</label>
          <input id="d-name" name="name" defaultValue={lead.name} required />
        </div>
        <div className={styles.field}>
          <label htmlFor="d-phone">WhatsApp / phone</label>
          <input id="d-phone" name="phone" type="tel" defaultValue={lead.phone ?? ""} />
        </div>
        <div className={styles.field}>
          <label htmlFor="d-email">Email</label>
          <input id="d-email" name="email" type="email" defaultValue={lead.email ?? ""} />
        </div>
        <div className={styles.field}>
          <label htmlFor="d-source">Where from</label>
          <select id="d-source" name="source" defaultValue={lead.source ?? "other"}>
            {SOURCES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="d-unit">Unit</label>
          <UnitSelect id="d-unit" name="unitNumber" units={units} defaultValue={lead.unitNumber ?? ""} />
        </div>
        <div className={styles.field}>
          <label htmlFor="d-interest">What they asked about</label>
          <input id="d-interest" name="interest" defaultValue={lead.interest ?? ""} />
        </div>
        <div className={styles.field}>
          <label htmlFor="d-pay">Payment</label>
          <select id="d-pay" name="paymentPreference" defaultValue={lead.paymentPreference ?? "undecided"}>
            {PAYMENT_PREFS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="d-price">Agreed price (USD)</label>
          <input
            id="d-price"
            name="agreedPriceUSD"
            inputMode="decimal"
            defaultValue={lead.agreedPriceUSD ?? ""}
            placeholder="Once agreed"
          />
        </div>
      </div>
      <SubmitButton>Save details</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

// ---- create the buyer login --------------------------------------------

export function CreateBuyerFromLeadForm({
  lead,
  units,
  defaultPrice,
}: {
  lead: Lead;
  units: UnitOption[];
  defaultPrice?: number;
}) {
  const [state, formAction] = useActionState(createBuyerFromLeadAction, initial);

  // The page refreshes the moment the login exists, so this panel keeps the
  // one-time password on screen itself instead of relying on the form below.
  if (state.status === "success" && state.generatedPassword) {
    return (
      <div>
        <p className={styles.formMsgOk}>{state.message}</p>
        <p style={{ marginTop: 10 }}>
          Password: <span className={styles.secret}>{state.generatedPassword}</span>
        </p>
        <p className={styles.sectionHint} style={{ marginTop: 8 }}>
          Copy it now, it won&apos;t be shown again. They sign in at lexington.com.gh/login.
        </p>
      </div>
    );
  }

  if (lead.buyerAccountId) {
    return (
      <p className={styles.sectionHint}>
        This prospect already has a buyer login. You can find it under{" "}
        <Link href="/admin" className={styles.leadLink}>
          Buyers
        </Link>
        .
      </p>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="leadId" value={lead._id} />
      <div className={styles.formGrid}>
        <div className={styles.field}>
          <label htmlFor="b-email">Login email</label>
          <input id="b-email" name="email" type="email" required defaultValue={lead.email ?? ""} />
        </div>
        <div className={styles.field}>
          <label htmlFor="b-name">Name</label>
          <input id="b-name" name="name" required defaultValue={lead.name} />
        </div>
        <div className={styles.field}>
          <label htmlFor="b-unit">Unit</label>
          <UnitSelect id="b-unit" name="unitNumber" units={units} defaultValue={lead.unitNumber ?? ""} />
        </div>
        <div className={styles.field}>
          <label htmlFor="b-price">Contract price (USD)</label>
          <input
            id="b-price"
            name="contractPriceUSD"
            inputMode="decimal"
            required
            defaultValue={defaultPrice ?? ""}
            placeholder="What they're paying"
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="b-pass">Password (blank = make one)</label>
          <input id="b-pass" name="password" autoComplete="off" />
        </div>
      </div>
      <SubmitButton pendingText="Creating…">Create buyer login</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
