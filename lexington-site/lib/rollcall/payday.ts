import type { PaydayLine } from "@/lib/expenses/shared";

// What a pay week's payments in Payday make in the expenses (lib/rollcall/wages.ts): one wage entry per way of
// paying (MoMo, cash, bank), one line per worker paid, and the steel machines on their own. Kept apart from the
// server code so it can be checked on its own.

/** The first pay week paid in the app (the roll call moved in on Sunday 1 Nov 2026): earlier weeks' wages were typed by hand. */
export const WAGES_FROM_WEEK = "2026-11-02";

/** The roll call's trades and their groups (its TRADES table): the group decides the QuickBooks class. */
export const TRADE_GROUP: Record<string, string> = {
  mforeman: "masonry",
  mason: "masonry",
  labourer: "masonry",
  carpenter: "carpentry",
  foreman: "carpentry",
  steel: "steel",
};
/** Payday's ways of paying, as the expenses name them. */
export const PAY_METHOD: Record<string, "MoMo" | "Cash" | "Bank transfer"> = { momo: "MoMo", cash: "Cash", bank: "Bank transfer" };

export interface PaydayGroup {
  /** The end of the entry's id: "momo", "cash", "bank", or "mach" for the machines. */
  key: string;
  method: "MoMo" | "Cash" | "Bank transfer";
  kind: "workers" | "machines";
  lines: PaydayLine[];
}

type Paid = { amount?: unknown; at?: unknown; method?: unknown; ref?: unknown; to?: unknown };
const money = (n: unknown) => (typeof n === "number" ? n : Number(n));

/**
 * The entries a week's payments make. `paid` is the week's record as the roll call keeps it (worker id ->
 * { amount, at, method, ref }, and "machines" -> { amount, at, method, to }); `workers` gives names and trades.
 */
export function paydayGroups(paid: Record<string, unknown>, workers: ReadonlyMap<string, { name?: string; trade?: string }>): PaydayGroup[] {
  const byMethod = new Map<string, PaydayLine[]>();
  const groups: PaydayGroup[] = [];
  for (const [id, raw] of Object.entries(paid)) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Paid;
    const amount = Math.round(money(p.amount) * 100) / 100;
    const method = typeof p.method === "string" && PAY_METHOD[p.method] ? p.method : "cash";
    if (!(amount > 0) || typeof p.at !== "string" || Number.isNaN(Date.parse(p.at))) continue;
    const ref = typeof p.ref === "string" && p.ref.trim() ? p.ref.trim().slice(0, 40) : null;
    if (id === "machines") {
      const to = typeof p.to === "string" && p.to.trim() ? p.to.trim().slice(0, 80) : "Steel machines";
      groups.push({ key: "mach", method: PAY_METHOD[method], kind: "machines", lines: [{ id, name: to, group: "machines", amount, at: p.at, ref }] });
      continue;
    }
    const w = workers.get(id);
    const line: PaydayLine = { id, name: (w?.name ?? "").trim() || "A worker", group: TRADE_GROUP[w?.trade ?? ""] ?? "masonry", amount, at: p.at, ref };
    byMethod.set(method, [...(byMethod.get(method) ?? []), line]);
  }
  for (const method of ["momo", "cash", "bank"]) {
    const lines = byMethod.get(method);
    if (lines?.length) groups.push({ key: method, method: PAY_METHOD[method], kind: "workers", lines: lines.sort((a, b) => a.name.localeCompare(b.name)) });
  }
  return groups;
}

/** The entry's figures: the total, and the day of the latest payment in it (when the money last left). */
export function groupFigures(g: PaydayGroup): { amount: number; date: string } {
  const amount = Math.round(g.lines.reduce((n, l) => n + l.amount, 0) * 100) / 100;
  const date = g.lines.map((l) => l.at).sort().pop()!.slice(0, 10);
  return { amount, date };
}
