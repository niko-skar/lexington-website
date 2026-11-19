"use client";

import { useOptimistic, useTransition } from "react";

import { setStageAction } from "@/lib/actions/crm";
import { STAGES, stageDef, stageLabel, type StageTone } from "@/lib/crm";
import styles from "./Crm.module.css";
import { runChange, useCrmHost, type CrmHostApi } from "./CrmHost";
import { useToast } from "./Toasts";

const TONE_CLASS: Record<StageTone, string> = {
  attention: styles.chipAttention,
  open: styles.chipOpen,
  won: styles.chipWon,
  done: styles.chipDone,
  lost: styles.chipLost,
};

// Moves a prospect to another stage in the background, with an Undo that moves
// them back. Shared by every control that changes a stage.
export async function saveStage(host: CrmHostApi, leadId: string, stage: string, fromStage: string, lostReason = "") {
  const data = new FormData();
  data.set("leadId", leadId);
  data.set("stage", stage);
  data.set("fromStage", fromStage);
  if (lostReason) data.set("lostReason", lostReason);
  await runChange(host, setStageAction, data);
}

// A stage chip you can change in place. The chip updates the instant it's
// picked; the save happens behind it.
export function StageSelect({ leadId, stage }: { leadId: string; stage: string | undefined }) {
  const [shown, setShown] = useOptimistic(stage ?? "new");
  const [, startTransition] = useTransition();
  const toast = useToast();
  const host = useCrmHost();

  function change(next: string) {
    if (next === shown) return;
    if (next === "lost" && !window.confirm("Mark this prospect as lost?")) return;
    const from = shown;

    startTransition(async () => {
      setShown(next);
      try {
        await saveStage(host, leadId, next, from);
      } catch {
        window.alert("Couldn't change the stage. Please try again.");
      }
    });
    toast.show(`Moved to ${stageLabel(next)}`, () => saveStage(host, leadId, from, next));
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
