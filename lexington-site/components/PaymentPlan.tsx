import { formatUSD } from "@/lib/format";
import type { PaymentPlanItem } from "@/lib/sanity/buyersTypes";
import styles from "@/components/Portal.module.css";

// A buyer's payment plan (Niko, 17 Nov 2026, for a buyer on a deposit and 12 monthly payments): every payment of the plan
// in order with its due date, each marked from what has been paid so far (the payments fill the plan from the top), and
// the next one above the list.

export type PlanState = "paid" | "part" | "next" | "overdue" | "later";
export type PlanRow = PaymentPlanItem & { paidUSD: number; state: PlanState };

/** The plan's payments in order, each marked from the total paid so far. `today` is YYYY-MM-DD. */
export function planRows(plan: PaymentPlanItem[], totalPaidUSD: number, today: string): PlanRow[] {
  let left = totalPaidUSD;
  let firstOpen = true;
  return plan
    .filter((r) => r && r.label && r.amountUSD > 0)
    .map((r) => {
      const paidUSD = Math.min(Math.max(left, 0), r.amountUSD);
      left -= r.amountUSD;
      let state: PlanState;
      if (paidUSD >= r.amountUSD - 0.5) state = "paid";
      else {
        const late = !!r.dueDate && r.dueDate < today;
        state = late ? "overdue" : firstOpen ? (paidUSD > 0 ? "part" : "next") : "later";
        firstOpen = false;
      }
      return { ...r, paidUSD, state };
    });
}

const day = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
const longDate = (d: string) => `${day(d, { weekday: "long" })} ${day(d, { day: "numeric", month: "long", year: "numeric" })}`; // "Monday 23 November 2026"
const shortDate = (d: string) => day(d, { day: "numeric", month: "short", year: "numeric" });

export function PaymentPlan({ plan, totalPaidUSD }: { plan: PaymentPlanItem[]; totalPaidUSD: number }) {
  const today = new Date().toISOString().slice(0, 10); // (Accra is on UTC)
  const rows = planRows(plan, totalPaidUSD, today);
  if (!rows.length) return null;
  const next = rows.find((r) => r.state !== "paid");
  const total = rows.reduce((s, r) => s + r.amountUSD, 0);
  const status = (r: PlanRow) =>
    r.state === "paid" ? "Paid ✓"
    : r.state === "part" ? `Part paid · ${formatUSD(Math.round(r.amountUSD - r.paidUSD))} to go`
    : r.state === "next" ? "Next"
    : r.state === "overdue" ? "Overdue"
    : "";

  return (
    <section className={styles.section} aria-labelledby="payment-plan">
      <h2 id="payment-plan" className={styles.sectionTitle}>
        Payment Plan
      </h2>
      {next ? (
        <div className={next.state === "overdue" ? `${styles.planNext} ${styles.planNextLate}` : styles.planNext}>
          <div className={styles.cardLabel}>Next payment</div>
          <div className={styles.cardValue}>{formatUSD(Math.round(next.amountUSD - next.paidUSD))}</div>
          <div className={styles.planNextText}>
            {next.label} · due by {longDate(next.dueDate)}
            {next.state === "overdue" ? " · overdue" : ""}
          </div>
        </div>
      ) : (
        <p className={styles.lead}>Every payment of your plan is paid. Thank you.</p>
      )}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Payment</th>
              <th>Due by</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r._key ?? i} className={r.state === "paid" ? styles.planPaid : r === next ? styles.planCurrent : undefined}>
                <td>{r.label}</td>
                <td>{r.dueDate ? shortDate(r.dueDate) : "—"}</td>
                <td>{formatUSD(r.amountUSD)}</td>
                <td className={r.state === "overdue" ? styles.planLate : undefined}>{status(r)}</td>
              </tr>
            ))}
            <tr className={styles.planTotal}>
              <td>Total</td>
              <td />
              <td>{formatUSD(total)}</td>
              <td>{formatUSD(Math.round(Math.min(totalPaidUSD, total)))} paid</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
