"use client";

import { useMemo, useState } from "react";

import { money, type Expense } from "@/lib/expenses/shared";
import { steelSummary, type SteelBuy } from "@/lib/expenses/steel";
import type { StoreItem } from "@/lib/store/shared";
import { errorText, send } from "./api";
import { niceDate } from "./ExpenseForm";
import s from "./Steel.module.css";
import styles from "./Todo.module.css";

// Steel bought against steel labour paid (lib/expenses/steel.ts says what and why): the tons bought, what bending
// and installing them costs at the rate a ton, what the steel benders were paid, and the balance. The entries
// behind it open below; a steel entry's tons can be typed when they can't be worked out (0 for a part payment).

const tonsText = (n: number) => `${Math.round(n * 1000) / 1000} t`;

export function SteelCard({
  expenses,
  items,
  rate,
  onChanged,
}: {
  expenses: Expense[];
  items: StoreItem[];
  rate: number;
  onChanged: (expense: Expense | null, rate: number) => void;
}) {
  const unitOf = useMemo(() => {
    const units = new Map(items.map((i) => [i.name.trim().toLowerCase(), i.unit]));
    return (material: string) => units.get(material.trim().toLowerCase()) ?? null;
  }, [items]);
  const sum = useMemo(() => steelSummary(expenses, rate, unitOf), [expenses, rate, unitOf]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!sum.bought.length && !sum.labour.length) return null;

  const save = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      const result = await send<{ rate: number; expense: Expense | null }>("/api/expenses/steel", "POST", body);
      onChanged(result.expense, result.rate);
      setEditing(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const tonsOf = (b: SteelBuy) => (b.tons === null ? "tons?" : b.how === "part payment" ? "part payment, no tons" : tonsText(b.tons));

  return (
    <section className={s.card} aria-label="Steel">
      <h2 className={styles.groupTitle}>
        Steel <span>labour {money(sum.rate).replace(".00", "")} a ton</span>
      </h2>
      <p className={s.big}>
        {tonsText(sum.tons)} bought · {money(sum.labourValue)} of labour
      </p>
      <p className={s.line}>{money(sum.paid)} paid to the steel benders</p>
      <p className={sum.balance >= 0 ? s.owe : s.ahead}>
        {sum.balance >= 0 ? `${money(sum.balance)} still to pay once it's all bent and installed` : `${money(-sum.balance)} paid ahead of the steel bought`}
      </p>
      {sum.unknown > 0 && <p className={s.warn}>{sum.unknown === 1 ? "One steel entry has" : `${sum.unknown} steel entries have`} no tons yet: open the entries and type them.</p>}
      <div className={s.buttons}>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Hide the entries" : "Show the entries"}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing("rate");
            setValue(String(sum.rate));
          }}
        >
          Change the rate
        </button>
      </div>
      {editing === "rate" && (
        <div className={s.edit}>
          <label>
            Labour a ton (GH₵)
            <input className={styles.input} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} />
          </label>
          <button type="button" className={s.save} onClick={() => void save({ rate: Number(value) })} disabled={busy}>
            Save
          </button>
          <button type="button" onClick={() => setEditing(null)} disabled={busy}>
            Cancel
          </button>
        </div>
      )}
      {error && <p className={styles.sheetError}>{error}</p>}
      {open && (
        <>
          <h3 className={s.sub}>Steel bought</h3>
          <ul className={s.list}>
            {sum.bought.map((b) => (
              <li key={b.id}>
                <span>
                  {niceDate(b.date)} · {b.supplier || "No supplier"} · {money(b.amount)}
                  {b.description ? ` · ${b.description}` : ""}
                </span>
                {editing === b.id ? (
                  <span className={s.edit}>
                    <input className={styles.input} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Tons" disabled={busy} />
                    <button type="button" className={s.save} onClick={() => void save({ id: b.id, tons: value.trim() === "" ? null : Number(value) })} disabled={busy}>
                      Save
                    </button>
                    <button type="button" onClick={() => setEditing(null)} disabled={busy}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className={b.tons === null ? s.tonsMissing : s.tons}
                    onClick={() => {
                      setEditing(b.id);
                      setValue(b.tons === null ? "" : String(b.tons));
                    }}
                  >
                    {tonsOf(b)} ✎
                  </button>
                )}
              </li>
            ))}
          </ul>
          <h3 className={s.sub}>Paid to the steel benders</h3>
          <ul className={s.list}>
            {sum.labour.map((l) => (
              <li key={l.id}>
                <span>
                  {niceDate(l.date)} · {l.supplier || "No name"} · <b>{money(l.amount)}</b>
                  {l.description ? ` · ${l.description}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
