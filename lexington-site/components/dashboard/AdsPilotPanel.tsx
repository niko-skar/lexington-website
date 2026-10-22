import { runAdsPilotAction, setAdsPilotPausedAction } from "@/lib/actions/adsPilot";
import type { PilotRun, PilotRunChange, PilotSettings } from "@/lib/agents/adsPilot";
import { usd } from "@/lib/agents/adsPilotCore";
import { formatWhen } from "@/lib/crm";

import styles from "./Dashboard.module.css";
import { PendingButton } from "./PendingButton";

function describe(c: PilotRunChange): string {
  const where = c.channel === "google" ? " (Google)" : "";
  if (c.kind === "pause") return `${c.name}${where}: paused`;
  if (c.kind === "enable") return `${c.name}${where}: switched back on`;
  return `${c.name}${where}: ${usd(c.fromBudget ?? 0)} → ${usd(c.toBudget ?? 0)} a day`;
}

function Change({ c, mode }: { c: PilotRunChange; mode: PilotRun["mode"] }) {
  const tag =
    c.done === "made"
      ? { label: "Done", className: styles.levelOk }
      : c.done === "queued"
        ? { label: "To Google", className: styles.levelOk }
        : mode === "on"
          ? { label: "Not done", className: styles.levelAct }
          : { label: "Would do", className: styles.levelWatch };
  return (
    <li className={styles.watchItem}>
      <span className={tag.className}>{tag.label}</span>
      <span>{describe(c)}</span>
      <span className={styles.watchDetail}>
        {c.reason}
        {c.error ? ` ${c.error}` : ""}
      </span>
    </li>
  );
}

/**
 * The ads autopilot on the dashboard: where the month's budget stands, what today's
 * allowance is and how it is split, what it changed this morning and why, and the
 * buttons to pause it or run it now.
 */
export function AdsPilotPanel({
  run,
  settings,
  paused,
}: {
  run: PilotRun | null;
  settings: PilotSettings;
  paused: boolean;
}) {
  const plan = run?.plan ?? null;
  const status =
    settings.mode === "off"
      ? "Switched off (the ADS_PILOT setting)."
      : settings.mode === "dry"
        ? "Trial mode: it works out what it would do and changes nothing."
        : paused
          ? "Paused by you: it changes no budgets. Facebook's monthly spending limit stays."
          : `On: keeps all the advertising within ${usd(settings.monthlyCap)} a month.`;
  const used = plan && plan.monthCap > 0 ? Math.min(1, plan.spentMtd / plan.monthCap) : 0;
  const earlier = (run?.recent ?? []).filter((c) => !run?.changes.some((now) => now._key === c._key));

  return (
    <section className={styles.pilot} aria-label="Ads autopilot">
      <div className={styles.watchHead}>
        <h2 className={styles.watchTitle}>Ads autopilot</h2>
        <span className={styles.watchWhen}>{run ? `Last run ${formatWhen(run.ranAt)} GMT` : "Runs every morning at 6"}</span>
        {settings.mode !== "off" && (
          <div className={styles.pilotActions}>
            {settings.mode === "on" && (
              <form action={setAdsPilotPausedAction}>
                <input type="hidden" name="paused" value={paused ? "0" : "1"} />
                <PendingButton label={paused ? "Resume" : "Pause"} pendingLabel={paused ? "Resuming…" : "Pausing…"} />
              </form>
            )}
            <form action={runAdsPilotAction}>
              <PendingButton label="Run now" pendingLabel="Running… (up to a minute)" />
            </form>
          </div>
        )}
      </div>

      <p className={styles.pilotStatus}>{status}</p>

      {plan && (
        <div className={styles.pilotMonth}>
          <div className={styles.pilotFigures}>
            <span>
              This month: <strong>{usd(plan.spentMtd)}</strong> of {usd(plan.monthCap)} spent
            </span>
            <span>
              <strong>{usd(plan.remaining)}</strong> left for {plan.daysLeft} day{plan.daysLeft === 1 ? "" : "s"}
            </span>
            <span>
              Today up to <strong>{usd(plan.dailyTarget)}</strong>
              {plan.allowance.google > 0 ? ` (Facebook ${usd(plan.allowance.meta)}, Google ${usd(plan.allowance.google)})` : ""}
            </span>
          </div>
          <div className={styles.pilotMeter} role="img" aria-label={`${Math.round(used * 100)}% of this month's budget spent`}>
            <div className={styles.pilotMeterFill} style={{ width: `${Math.round(used * 100)}%` }} />
          </div>
          {run?.limit && (
            <p className={styles.sub}>
              Facebook&rsquo;s own spending limit for {run.limit.month === run.today.slice(0, 7) ? "this month" : run.limit.month}:{" "}
              {usd(run.limit.value)} (it stops the adverts by itself if everything else failed).
            </p>
          )}
        </div>
      )}

      {run && run.errors.length > 0 && (
        <ul className={styles.watchList} style={{ marginTop: 12 }}>
          {run.errors.map((e) => (
            <li key={e} className={styles.watchItem}>
              <span className={styles.levelAct}>Problem</span>
              <span>{e}</span>
            </li>
          ))}
        </ul>
      )}

      {run && run.changes.length > 0 ? (
        <ul className={styles.watchList} style={{ marginTop: 12 }}>
          {run.changes.map((c) => (
            <Change key={c._key} c={c} mode={run.mode} />
          ))}
        </ul>
      ) : run?.plan ? (
        <p className={styles.hint} style={{ marginTop: 10 }}>
          No changes needed on the last run.
        </p>
      ) : null}

      {run && run.notes.length > 0 && (
        <ul className={styles.pilotNotes}>
          {run.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      {earlier.length > 0 && (
        <details className={styles.watchMore}>
          <summary>Earlier changes</summary>
          <ul className={styles.watchList}>
            {earlier.slice(0, 20).map((c) => (
              <li key={c._key} className={styles.watchItem}>
                <span className={styles.levelOk}>{c.day.slice(8, 10)}/{c.day.slice(5, 7)}</span>
                <span>{describe(c)}</span>
                <span className={styles.watchDetail}>{c.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
