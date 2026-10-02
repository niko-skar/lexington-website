"use client";

import { useOptimistic, useTransition } from "react";

import { setStageAction } from "@/lib/actions/crm";
import { STAGES, stageDef, type StageTone } from "@/lib/crm";
import styles from "./Crm.module.css";

const TONE_CLASS: Record<StageTone, string> = {
  attention: styles.chipAttention,
  open: styles.chipOpen,
  won: styles.chipWon,
  done: styles.chipDone,
  lost: styles.chipLost,
};

// A stage chip you can change in place. The chip updates the instant it's
// picked; the save happens behind it.
export function StageSelect({ leadId, stage }: { leadId: string; stage: string | undefined }) {
  const [shown, setShown] = useOptimistic(stage ?? "new");
  const [, startTransition] = useTransition();

  function change(next: string) {
    if (next === shown) return;
    if (next === "lost" && !window.confirm("Mark this prospect as lost?")) return;
    const from = shown;

    startTransition(async () => {
      setShown(next);
      const data = new FormData();
      data.set("leadId", leadId);
      data.set("stage", next);
      data.set("fromStage", from);
      try {
        await setStageAction(data);
      } catch {
        window.alert("Couldn't change the stage. Please try again.");
      }
    });
  }

  return (
    <select
      className={`${TONE_CLASS[stageDef(shown).tone]} ${styles.stageSelect}`}
      value={shown}
      onChange={(e) => change(e.target.value)}
      aria-label="Change stage"
    >
      {STAGES.map((s) => (
        <option key={s.key} value={s.key}>
          {s.label}
        </option>
      ))}
    </select>
  );
}
