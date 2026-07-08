import type { UnitStatus } from "@/lib/sanity/types";
import styles from "./StatusBadge.module.css";

const LABEL: Record<UnitStatus, string> = {
  available: "Available",
  reserved: "Reserved",
  sold: "Sold",
};

export function StatusBadge({ status }: { status: UnitStatus }) {
  return <span className={`${styles.badge} ${styles[status]}`}>{LABEL[status]}</span>;
}
