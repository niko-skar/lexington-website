import { stageDef, type StageTone } from "@/lib/crm";
import styles from "./Crm.module.css";

const TONE_CLASS: Record<StageTone, string> = {
  attention: styles.chipAttention,
  open: styles.chipOpen,
  won: styles.chipWon,
  done: styles.chipDone,
  lost: styles.chipLost,
};

export function StageChip({ stage }: { stage: string | undefined }) {
  const def = stageDef(stage);
  return <span className={TONE_CLASS[def.tone]}>{def.label}</span>;
}
