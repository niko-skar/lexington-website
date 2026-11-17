"use client";

import { useState } from "react";

import { Unit3DPlan } from "@/components/Penthouse3D";
import type { PlanLevel } from "@/lib/models3d";
import styles from "@/components/Portal.module.css";

// The buyer's homes in 3D on the first page of the portal: one 3D box (the Residences page's), and when the account has
// more than one home, a switch above it (Niko, 17 Nov 2026: a buyer of a two-bedroom and a studio on two floors). One
// model at a time: two live 3D views at once would be heavy on a laptop.
export function HomesIn3D({ homes }: { homes: { unitNumber: string; label: string; startLevel: PlanLevel }[] }) {
  const [i, setI] = useState(0);
  if (!homes.length) return null;
  const cur = homes[Math.min(i, homes.length - 1)];
  return (
    <div>
      {homes.length > 1 && (
        <div className={styles.homeSwitch} role="group" aria-label="Which home to show in 3D">
          {homes.map((h, k) => (
            <button key={h.unitNumber} type="button" aria-pressed={k === i} onClick={() => setI(k)}>
              {h.label}
            </button>
          ))}
        </div>
      )}
      <Unit3DPlan key={cur.unitNumber} unitNumber={cur.unitNumber} startLevel={cur.startLevel} />
    </div>
  );
}
