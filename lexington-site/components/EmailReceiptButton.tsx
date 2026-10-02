"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { emailReceiptNowAction, type EmailReceiptState } from "@/lib/actions/receipts";
import styles from "./Portal.module.css";

const initial: EmailReceiptState = { status: "idle", message: "" };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.receiptButton} disabled={pending}>
      {pending ? "Sending…" : label}
    </button>
  );
}

export function EmailReceiptButton({
  buyerId,
  paymentKey,
  label,
}: {
  buyerId: string;
  paymentKey: string;
  label: string;
}) {
  const [state, formAction] = useActionState(emailReceiptNowAction, initial);

  return (
    <form action={formAction}>
      <input type="hidden" name="buyerId" value={buyerId} />
      <input type="hidden" name="paymentKey" value={paymentKey} />
      <Submit label={label} />
      {state.status !== "idle" && (
        <p className={state.status === "success" ? styles.receiptOk : styles.receiptErr}>{state.message}</p>
      )}
    </form>
  );
}
