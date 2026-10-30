// The site roll call in the Lexington app (Niko, 30 Oct 2026: "put the site roll call and the site to do onto
// one app ... Seraphina will have her own login just for site roll call. I will have full access"). The roll
// call keeps the page it had as a Claude page (/todo/rollcall); its records live in the website now. A login
// opens any of its three parts: Today (marking, overtime, steel machines, curing and pour checklists), Payday
// (wages and payments) and Workers (the people, their numbers and ID photos, the pour checklists).

export const ROLLCALL_PARTS = ["rollcall", "payday", "workers"] as const;
export type RollcallPart = (typeof ROLLCALL_PARTS)[number];

/** The page's record kinds, as the page names them ("days/2026-11-02", "config/settings"). */
export const ROLLCALL_COLLECTIONS = ["workers", "days", "payments", "pours", "checklists", "config"] as const;
export type RollcallCollection = (typeof ROLLCALL_COLLECTIONS)[number];

export interface RollcallAccess {
  rollcall: boolean;
  payday: boolean;
  workers: boolean;
}

export const rollcallAccess = (sections: readonly string[]): RollcallAccess => ({
  rollcall: sections.includes("rollcall"),
  payday: sections.includes("payday"),
  workers: sections.includes("workers"),
});

export const opensRollcall = (sections: readonly string[]) => ROLLCALL_PARTS.some((p) => sections.includes(p));

/** One record as the page gets it: what this login may see of it, and its version. */
export interface RollcallDoc {
  col: RollcallCollection;
  key: string;
  data: Record<string, unknown>;
  rev: string;
  at: string;
}
