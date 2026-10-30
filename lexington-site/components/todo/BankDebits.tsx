"use client";

import { useState } from "react";

import { debitWords, money, shopOf, type BankDebit } from "@/lib/expenses/shared";
import bank from "./BankDebits.module.css";
import { niceDate } from "./ExpenseForm";
import styles from "./Todo.module.css";

// Money out from the bank's own texts, waiting at the top of the expenses (lib/expenses/bankDebit.ts): each one
// is completed in the form below (who, what for, the receipt), or put aside as not an expense (a transfer
// between his own accounts, cash taken out). The bank's fees on them are filed already, and say so.

export function BankDebits({
  pending,
  completing,
  onComplete,
  onDismiss,
}: {
  pending: BankDebit[];
  /** The one in the form right now. */
  completing: string | null;
  onComplete: (d: BankDebit) => void;
  onDismiss: (d: BankDebit) => void;
}) {
  const [armed, setArmed] = useState<string | null>(null);
  if (!pending.length) return null;
  return (
    <section className={bank.box} aria-label="From the bank">
      <h2 className={styles.groupTitle}>
        From the bank <span>{pending.length} to complete</span>
      </h2>
      {pending.map((d) => {
        const place = d.where ? shopOf(d.where).place : "";
        return (
          <article key={d.id} id={d.id} className={`${bank.card} ${completing === d.id ? bank.cardOn : ""}`}>
            <div className={bank.top}>
              <span className={bank.amount}>{money(d.amount)}</span>
              <span className={bank.when}>
                {niceDate(d.date)}
                {d.time ? ` ${d.time}` : ""}
              </span>
            </div>
            <p className={bank.what}>
              {debitWords(d).replace(/^./, (c) => c.toUpperCase())}
              {place ? ` · ${place}` : ""}
            </p>
            {!d.siteAccount && <p className={bank.other}>Account ending {d.account.replace(/^.*x/, "")}, not the one Leo pays into.</p>}
            {d.fees.map((f, i) => (
              <p key={i} className={bank.fee}>
                + the bank&rsquo;s fee {money(f.amount)}, filed by itself{f.ref ? ` (${f.ref})` : ""}
              </p>
            ))}
            {completing === d.id ? (
              <p className={bank.now}>In the form below: say what it was for and add the receipt.</p>
            ) : (
              <div className={bank.buttons}>
                <button type="button" className={bank.complete} onClick={() => onComplete(d)}>
                  Complete
                </button>
                <button
                  type="button"
                  className={armed === d.id ? `${bank.aside} ${styles.dangerArmed}` : bank.aside}
                  onClick={() => {
                    if (armed !== d.id) return setArmed(d.id);
                    setArmed(null);
                    onDismiss(d);
                  }}
                >
                  {armed === d.id ? "Tap again: not an expense" : "Not an expense"}
                </button>
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
