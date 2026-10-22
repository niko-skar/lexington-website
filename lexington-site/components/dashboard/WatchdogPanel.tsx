import { runWatchdogAction } from "@/lib/actions/watchdog";
import type { WatchdogRun } from "@/lib/agents/watchdog";
import type { Finding } from "@/lib/agents/watchdogCore";
import { formatWhen } from "@/lib/crm";

import { CheckNowButton } from "./CheckNowButton";
import styles from "./Dashboard.module.css";

const LEVEL: Record<Finding["level"], { label: string; className: string }> = {
  act: { label: "Needs you", className: styles.levelAct },
  watch: { label: "Watch", className: styles.levelWatch },
  ok: { label: "OK", className: styles.levelOk },
};

function Item({ f }: { f: Finding }) {
  return (
    <li className={styles.watchItem}>
      <span className={LEVEL[f.level].className}>{LEVEL[f.level].label}</span>
      <span>{f.title}</span>
      {f.detail && <span className={styles.watchDetail}>{f.detail}</span>}
    </li>
  );
}

/**
 * The ads watchdog's latest check, at the top of the dashboard: what needs Niko,
 * what to watch, and (folded away) the plain numbers. The morning run emails him;
 * "Check now" runs the same check without the email.
 */
export function WatchdogPanel({ run }: { run: WatchdogRun | null }) {
  const findings = run?.findings ?? [];
  const urgent = findings.filter((f) => f.level !== "ok");
  const numbers = findings.filter((f) => f.level === "ok");

  return (
    <section className={styles.watch} aria-label="Daily ads check">
      <div className={styles.watchHead}>
        <h2 className={styles.watchTitle}>Daily ads check</h2>
        <span className={styles.watchWhen}>
          {run ? `Last checked ${formatWhen(run.ranAt)} GMT${run.emailed ? ", emailed to you" : ""}` : "Runs every morning at 7"}
        </span>
        <form action={runWatchdogAction}>
          <CheckNowButton />
        </form>
      </div>

      {run?.summary && <p className={styles.watchNote}>{run.summary}</p>}

      {!run ? (
        <p className={styles.hint}>No check has run yet. Press &ldquo;Check now&rdquo;, or wait for the morning one.</p>
      ) : urgent.length ? (
        <ul className={styles.watchList}>
          {urgent.map((f) => (
            <Item key={f._key} f={f} />
          ))}
        </ul>
      ) : (
        <p className={styles.hint}>Nothing needs you today.</p>
      )}

      {numbers.length > 0 && (
        <details className={styles.watchMore}>
          <summary>The numbers behind it</summary>
          <ul className={styles.watchList}>
            {numbers.map((f) => (
              <Item key={f._key} f={f} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
