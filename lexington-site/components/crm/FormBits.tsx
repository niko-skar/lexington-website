"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { formatUSD } from "@/lib/format";
import type { CrmFormState } from "@/lib/actions/crm";
import type { UnitOption } from "@/lib/sanity/crmTypes";
import styles from "./Crm.module.css";

export function SubmitButton({
  children,
  pendingText = "Saving…",
  className = styles.btnPrimary,
}: {
  children: ReactNode;
  pendingText?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? pendingText : children}
    </button>
  );
}

export function FormMessage({ state }: { state: CrmFormState }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <p className={state.status === "success" ? styles.formMsgOk : styles.formMsgErr}>{state.message}</p>
  );
}

export function UnitSelect({
  name,
  units,
  defaultValue = "",
  id,
}: {
  name: string;
  units: UnitOption[];
  defaultValue?: string;
  id?: string;
}) {
  return (
    <select id={id ?? name} name={name} defaultValue={defaultValue}>
      <option value="">Not chosen yet</option>
      {/* A saved unit that's no longer in the list must stay selectable, or
          saving the form would silently wipe it. */}
      {defaultValue && !units.some((u) => u.unitNumber === defaultValue) && (
        <option value={defaultValue}>{defaultValue}</option>
      )}
      {units.map((u) => (
        <option key={u.unitNumber} value={u.unitNumber}>
          {u.unitNumber} · {u.bedroomType} · {u.areaSqm} sqm · {formatUSD(u.priceUSD)}
          {u.status !== "available" ? ` (${u.status})` : ""}
        </option>
      ))}
    </select>
  );
}
