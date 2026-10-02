"use client";

import { createContext, useContext, useOptimistic, useState, useTransition, type ReactNode } from "react";

import { LOST_REASONS, STAGES, stageLabel } from "@/lib/crm";
import styles from "./Crm.module.css";
import { StageChip } from "./StageChip";
import { saveStage } from "./StageSelect";
import { useToast } from "./Toasts";

interface StageContext {
  stage: string;
  change: (next: string, reason?: string) => void;
}

const Context = createContext<StageContext | null>(null);

function useStage() {
  const value = useContext(Context);
  if (!value) throw new Error("Stage controls must sit inside <StageProvider>.");
  return value;
}

// The chip at the top of a prospect's page and the stage buttons further down
// share one stage, so both change the instant you pick one.
export function StageProvider({
  leadId,
  stage,
  children,
}: {
  leadId: string;
  stage: string;
  children: ReactNode;
}) {
  const [shown, setShown] = useOptimistic(stage);
  const [, startTransition] = useTransition();
  const toast = useToast();

  function change(next: string, reason = "") {
    const from = shown;
    startTransition(async () => {
      setShown(next);
      try {
        await saveStage(leadId, next, from, reason);
      } catch {
        window.alert("Couldn't change the stage. Please try again.");
      }
    });
    toast.show(`Moved to ${stageLabel(next)}`, () => saveStage(leadId, from, next));
  }

  return <Context.Provider value={{ stage: shown, change }}>{children}</Context.Provider>;
}

export function LiveStageChip() {
  return <StageChip stage={useStage().stage} />;
}

export function StagePills() {
  const { stage, change } = useStage();

  return (
    <div className={styles.stageRow}>
      {STAGES.filter((s) => s.key !== "lost").map((s) =>
        s.key === stage ? (
          <span key={s.key} className={styles.stagePillActive}>
            {s.label}
          </span>
        ) : (
          <button key={s.key} type="button" className={styles.stagePill} onClick={() => change(s.key)}>
            {s.label}
          </button>
        )
      )}
    </div>
  );
}

export function LostControls({ lostReason }: { lostReason?: string }) {
  const { stage, change } = useStage();
  const [reason, setReason] = useState("");

  if (stage === "lost") {
    const why = lostReason || reason;
    return (
      <div className={styles.lostForm}>
        <span className={styles.sectionHint}>Lost{why ? `: ${why}` : ""}</span>
        <button type="button" className={styles.btn} onClick={() => change("contacted")}>
          Reopen
        </button>
      </div>
    );
  }

  return (
    <div className={styles.lostForm}>
      <select value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Why they're lost">
        <option value="">Not going ahead because…</option>
        {LOST_REASONS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <button type="button" className={styles.btnDanger} onClick={() => change("lost", reason)}>
        Mark lost
      </button>
    </div>
  );
}
