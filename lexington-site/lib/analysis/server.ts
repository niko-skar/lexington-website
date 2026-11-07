import "server-only";

import { cashflowNow } from "@/lib/cashflow/server";
import { linesOf, type Expense } from "@/lib/expenses/shared";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { ITEM_PREFIX } from "@/lib/site/ids";
import { floorName } from "@/lib/spending/shared";
import { spendingSources } from "@/lib/spending/server";
import { ghanaDay } from "@/lib/store/shared";
import {
  byGroup,
  byMonth,
  byWeek,
  doublesOf,
  gapsOf,
  materialTally,
  moneyFrom,
  PRICE_KEYS,
  priceTrend,
  type AnalysisData,
  type CostLine,
  type MoneyIn,
  type TypedMaterial,
} from "./shared";

// The analysis (lib/analysis/shared.ts says what and why), worked out from the spending's own sources: QuickBooks'
// transactions line by line (an app entry in QuickBooks lends it its typed materials, by its EXP number), the app's
// entries and bills not in QuickBooks yet, the app's money in, and the Cash flow tab's outlook.

const NOT_SAID = "Whole building / not said";

export async function analysisData(): Promise<AnalysisData> {
  const [src, units, outlook] = await Promise.all([
    spendingSources(),
    getBuyersClient().fetch<{ id: string; unit: string | null }[]>(`*[_type == "storeItem" && string::startsWith(_id, $prefix)]{ "id": _id, unit }`, { prefix: ITEM_PREFIX }),
    cashflowNow().catch((error) => {
      console.error("[analysis] cash flow:", error instanceof Error ? error.message : error);
      return null;
    }),
  ]);
  const unitOf = new Map(units.map((u) => [u.id, u.unit]));
  const typedOf = (x: Expense): TypedMaterial[] | null => {
    const lines = linesOf(x);
    return lines.length ? lines.map((l) => ({ name: l.material, qty: l.qty, unit: l.itemId ? (unitOf.get(l.itemId) ?? null) : null })) : null;
  };
  const words = (x: Pick<Expense, "material" | "description">) => [x.material, x.description].filter(Boolean).join(" · ");
  const byRef = new Map(src.expenses.filter((x) => x.ref).map((x) => [x.ref!, x]));
  const billByRef = new Map(src.bills.filter((b) => b.appRef).map((b) => [b.appRef!, b]));
  const floorOf = (name: string | null | undefined) => (name && name !== "Whole building" ? (floorName(name, src.floors) ?? name) : null);

  const lines: CostLine[] = [];
  for (const t of src.txns) {
    if (t.type === "BillPayment") continue;
    // Made by the app: its own entry has the materials as typed.
    const app = t.appRef ? byRef.get(t.appRef) : undefined;
    const bill = !app && t.appRef ? billByRef.get(t.appRef) : undefined;
    const memo = t.memo.replace(/^((?:EXP|IN|BILL)-\d{4,}) from the site app( · )?/, "");
    t.lines.forEach((l, i) =>
      lines.push({
        entry: `qbo:${t.type}:${t.id}`,
        kind: t.type === "Bill" ? "bill" : t.total < 0 ? "credit" : "expense",
        date: t.date,
        supplier: t.vendorName ?? t.payee ?? "",
        amount: l.amount,
        cls: l.className,
        text: (i === 0 && app ? words(app) : i === 0 && bill ? bill.description : l.description || memo).slice(0, 200),
        floor: floorOf(t.location?.name),
        typed: i === 0 && app ? typedOf(app) : null,
        category: app?.category ?? null,
        payday: app?.payday?.kind ?? null,
        steelTons: app?.steelTons ?? null,
        ref: t.appRef ?? (t.doc || null),
      })
    );
  }
  for (const x of src.appOnly) {
    // A payment of a supplier's bill: the bill holds the cost.
    if (x.billId) continue;
    lines.push({
      entry: `app:${x.id}`,
      kind: "expense",
      date: x.date,
      supplier: x.supplier.trim(),
      amount: x.amount,
      cls: x.costClass?.name ?? null,
      text: words(x).slice(0, 200),
      floor: floorOf(x.floor),
      typed: typedOf(x),
      category: x.category,
      payday: x.payday?.kind ?? null,
      steelTons: x.steelTons,
      ref: x.ref,
    });
  }
  for (const b of src.billsOnly) {
    lines.push({
      entry: `bill:${b.id}`,
      kind: "bill",
      date: b.date,
      supplier: b.supplier,
      amount: b.amount,
      cls: b.costClass?.name ?? null,
      text: b.description.slice(0, 200),
      floor: floorOf(b.floor),
      typed: null,
      category: null,
      payday: null,
      steelTons: null,
      ref: b.appRef,
    });
  }

  const today = ghanaDay();
  const ins: MoneyIn[] = src.expenses
    .filter((x) => x.kind === "inflow" && (x.forWho === "Site" || x.forWho === "Event"))
    .map((x) => ({ date: x.date, amount: x.amount, from: moneyFrom(x.supplier) }));
  const from = ins.map((m) => m.date).sort()[0] ?? null;
  const weeks = from ? byWeek(lines, ins, from, today) : [];
  const sum = (ns: number[]) => Math.round(ns.reduce((a, b) => a + b, 0) * 100) / 100;
  const floors = new Map<string, number>();
  for (const l of lines) floors.set(l.floor ?? NOT_SAID, (floors.get(l.floor ?? NOT_SAID) ?? 0) + l.amount);
  const materials = materialTally(lines);
  const prices = PRICE_KEYS.flatMap((key) => {
    const row = materials.find((m) => m.key === key);
    const trend = row ? priceTrend(row) : null;
    return row && trend ? [{ key, name: row.name, unit: row.unit, ...trend }] : [];
  });
  const forecast = outlook?.forecast;
  return {
    today,
    spent: sum(lines.map((l) => l.amount)),
    first: lines.map((l) => l.date).sort()[0] ?? null,
    groups: byGroup(lines),
    months: byMonth(lines),
    floors: [...floors.entries()].map(([name, amount]) => ({ name, amount: Math.round(amount * 100) / 100 })).sort((a, b) => b.amount - a.amount),
    weeks,
    since: from
      ? {
          from,
          spent: sum(lines.filter((l) => l.date >= from).map((l) => l.amount)),
          in: sum(ins.map((m) => m.amount)),
          leo: sum(ins.filter((m) => m.from === "leo").map((m) => m.amount)),
          buyers: sum(ins.filter((m) => m.from === "buyer").map((m) => m.amount)),
        }
      : null,
    materials,
    prices,
    doubles: doublesOf(lines),
    gaps: gapsOf(lines, today),
    cash: forecast
      ? {
          now: forecast.now,
          typedAt: outlook.typedAt,
          short: forecast.short,
          lowest: forecast.lowest,
          leoWeekly: forecast.leo.weekly,
          wagesWeekly: forecast.wages.weekly,
        }
      : null,
    fetchedAt: src.status.fetchedAt,
    connected: src.connected,
  };
}
