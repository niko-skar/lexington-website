import type { SelfFinanceRow } from "@/lib/sanity/types";
import { Reveal } from "./Reveal";
import styles from "./PaymentStepper.module.css";

export function PaymentStepper({ rows }: { rows: SelfFinanceRow[] }) {
  return (
    <div className={styles.stepper}>
      {rows.map((row, i) => (
        <Reveal key={row.milestone} delay={i * 60} className={styles.step}>
          <div className={styles.milestone}>{row.milestone}</div>
          <div className={styles.timeframe}>{row.timeframe}</div>
          <span className={styles.discount}>{row.option1} due</span>
        </Reveal>
      ))}
    </div>
  );
}
