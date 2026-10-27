"use client";

import { startTransition, useActionState, useState } from "react";

import { saveBuyerDetailsAction, type DetailsFormState } from "@/lib/actions/buyerDetails";
import type { BuyerDetails } from "@/lib/sanity/buyersTypes";
import styles from "./Portal.module.css";

// The buyer's own details for their agreement (Next steps on the buyer portal). The fields are
// controlled and the form is sent by hand rather than through <form action>: React resets a form
// after its action, which cleared the ticked radio buttons when the server answered with something to fix.
export function BuyerDetailsForm({ saved }: { saved?: BuyerDetails }) {
  const [state, formAction, pending] = useActionState<DetailsFormState, FormData>(saveBuyerDetailsAction, { status: "idle" });
  const [v, setV] = useState({
    citizenOfGhana: saved?.citizenOfGhana === true ? "yes" : saved?.citizenOfGhana === false && saved.submittedAt ? "no" : "",
    otherCitizenship: saved?.otherCitizenship ?? "",
    idType: saved?.idType ?? "",
    idNumber: saved?.idNumber ?? "",
    idCountry: saved?.idCountry ?? "",
    address: saved?.address ?? "",
    emergencyName: saved?.emergencyName ?? "",
    emergencyRelationship: saved?.emergencyRelationship ?? "",
    emergencyAddress: saved?.emergencyAddress ?? "",
    emergencyEmail: saved?.emergencyEmail ?? "",
    emergencyPhone: saved?.emergencyPhone ?? "",
    comments: saved?.comments ?? "",
    readDraft: Boolean(saved?.submittedAt),
  });
  const set = (name: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setV((old) => ({ ...old, [name]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Citizenship</legend>
        <p className={styles.hint}>Are you a citizen of Ghana?</p>
        <div className={styles.choices}>
          <label className={styles.choice}>
            <input type="radio" name="citizenOfGhana" value="yes" checked={v.citizenOfGhana === "yes"} onChange={set("citizenOfGhana")} />
            Yes
          </label>
          <label className={styles.choice}>
            <input type="radio" name="citizenOfGhana" value="no" checked={v.citizenOfGhana === "no"} onChange={set("citizenOfGhana")} />
            No
          </label>
        </div>
        <label className={styles.field}>
          <span>{v.citizenOfGhana === "no" ? "Your citizenship (country)" : "Any other citizenship? (country, optional)"}</span>
          <input name="otherCitizenship" value={v.otherCitizenship} onChange={set("otherCitizenship")} maxLength={80} placeholder="e.g. the United States of America" />
        </label>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Identification</legend>
        <div className={styles.choices}>
          <label className={styles.choice}>
            <input type="radio" name="idType" value="passport" checked={v.idType === "passport"} onChange={set("idType")} />
            Passport
          </label>
          <label className={styles.choice}>
            <input type="radio" name="idType" value="ghana-card" checked={v.idType === "ghana-card"} onChange={set("idType")} />
            Ghana Card
          </label>
        </div>
        <label className={styles.field}>
          <span>{v.idType === "ghana-card" ? "Ghana Card number" : "Passport number"}</span>
          <input name="idNumber" value={v.idNumber} onChange={set("idNumber")} maxLength={40} autoComplete="off" />
        </label>
        {v.idType !== "ghana-card" && (
          <label className={styles.field}>
            <span>Country that issued your passport</span>
            <input name="idCountry" value={v.idCountry} onChange={set("idCountry")} maxLength={80} placeholder="e.g. the United States of America" />
          </label>
        )}
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Your address</legend>
        <label className={styles.field}>
          <span>Home address (for the agreement and for notices)</span>
          <textarea name="address" value={v.address} onChange={set("address")} maxLength={300} rows={3} autoComplete="street-address" />
        </label>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Emergency contact</legend>
        <p className={styles.hint}>Someone we can also send a copy of formal notices to.</p>
        <div className={styles.fieldRow}>
          <label className={styles.field}>
            <span>Full name</span>
            <input name="emergencyName" value={v.emergencyName} onChange={set("emergencyName")} maxLength={100} />
          </label>
          <label className={styles.field}>
            <span>Relationship to you (optional)</span>
            <input name="emergencyRelationship" value={v.emergencyRelationship} onChange={set("emergencyRelationship")} maxLength={60} />
          </label>
        </div>
        <div className={styles.fieldRow}>
          <label className={styles.field}>
            <span>Email</span>
            <input type="email" name="emergencyEmail" value={v.emergencyEmail} onChange={set("emergencyEmail")} maxLength={120} />
          </label>
          <label className={styles.field}>
            <span>Phone</span>
            <input type="tel" name="emergencyPhone" value={v.emergencyPhone} onChange={set("emergencyPhone")} maxLength={40} />
          </label>
        </div>
        <label className={styles.field}>
          <span>Address (optional)</span>
          <textarea name="emergencyAddress" value={v.emergencyAddress} onChange={set("emergencyAddress")} maxLength={300} rows={2} />
        </label>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>The draft agreement</legend>
        <label className={styles.field}>
          <span>Any questions, or changes you would like? (optional)</span>
          <textarea name="comments" value={v.comments} onChange={set("comments")} maxLength={2000} rows={4} />
        </label>
        <label className={styles.check}>
          <input type="checkbox" name="readDraft" checked={v.readDraft} onChange={set("readDraft")} />
          I have read the draft agreement.
        </label>
      </fieldset>

      {state.status !== "idle" && state.message && (
        <p className={state.status === "ok" ? styles.formOk : styles.formErr} role="status">
          {state.message}
        </p>
      )}
      <button type="submit" className={styles.submit} disabled={pending}>
        {pending ? "Sending…" : saved?.submittedAt ? "Send updated details" : "Send my details"}
      </button>
    </form>
  );
}
