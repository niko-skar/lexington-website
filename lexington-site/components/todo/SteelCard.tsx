"use client";

import { useMemo } from "react";

import { money, type Expense } from "@/lib/expenses/shared";
import { STEEL_RATE, steelSummary } from "@/lib/expenses/steel";
import type { StoreItem } from "@/lib/store/shared";
import s from "./Steel.module.css";
import styles from "./Todo.module.css";

// The steel on the expenses (lib/expenses/steel.ts says what and why): the tons bought and what the steel benders
// were paid, from the entries below. The tons installed and what they're owed are on the steel page (/todo/steel).

const tonsText = (n: number) => `${Math.round(n * 1000) / 1000} t`;

export function SteelCard({ expenses, items, onOpen }: { expenses: Expense[]; items: StoreItem[]; onOpen: () => void }) {
  const sum = useMemo(() => {
    const units = new Map(items.map((i) => [i.name.trim().toLowerCase(), i.unit]));
    return steelSummary(expenses, STEEL_RATE, (m) => units.get(m.trim().toLowerCase()) ?? null);
  }, [expenses, items]);
  if (!sum.bought.length && !sum.labour.length) return null;

  return (
    <section className={s.card} aria-label="Steel">
      <h2 className={styles.groupTitle}>Steel</h2>
      <p className={s.line}>
        <b>{tonsText(sum.tons)}</b> bought · <b>{money(sum.paid)}</b> paid to the steel benders
      </p>
      {sum.unknown > 0 && <p className={s.warn}>{sum.unknown === 1 ? "One steel entry has" : `${sum.unknown} steel entries have`} no tons yet: type them on the steel page.</p>}
      <div className={s.buttons}>
        <a
          href="/todo/steel"
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            onOpen();
          }}
        >
          Tons installed and what&rsquo;s owed →
        </a>
      </div>
    </section>
  );
}
