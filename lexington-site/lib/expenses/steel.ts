import type { Expense } from "./shared";

// Steel bought against steel labour paid (Niko, 31 Oct 2026: "will also shortly have to track how much steel i buy
// and how much steel labour i pay to see the balance, i pay wonder 2000ghc per ton of steel bent and installed").
// Worked out from the expenses as they are: the steel bought in tons ("Steel high tensile", 28.5 t...) and what the
// steel benders were paid (Wonder, an advance to deduct...). The labour the bought steel will cost is its tons at
// the rate a ton; what's left is what is still to pay once it's all bent and installed (or paid ahead).

export const STEEL_RATE = 2000;

export interface SteelBuy {
  id: string;
  ref: string | null;
  date: string;
  supplier: string;
  description: string;
  amount: number;
  /** Tons this entry brought (0 for a part payment), or null when it can't tell (type them in). */
  tons: number | null;
  /** Where the tons come from. */
  how: "typed" | "quantity" | "part payment" | "unknown";
}

export interface SteelPay {
  id: string;
  ref: string | null;
  date: string;
  supplier: string;
  description: string;
  amount: number;
}

export interface SteelSummary {
  rate: number;
  tons: number;
  /** Steel buys whose tons aren't known (not counted). */
  unknown: number;
  labourValue: number;
  paid: number;
  /** Still to pay once all the bought steel is bent and installed (below 0: paid ahead). */
  balance: number;
  bought: SteelBuy[];
  labour: SteelPay[];
}

const text = (x: Pick<Expense, "material" | "description" | "supplier">) => `${x.material ?? ""} ${x.description} ${x.supplier}`;
const className = (x: Pick<Expense, "costClass">) => x.costClass?.name.toLowerCase() ?? "";

/** Steel bought for the site: its class says so, or it's a material whose name does (never binding wire or nails). */
export function isSteelBuy(x: Expense): boolean {
  if (x.kind !== "expense" || x.forWho !== "Site" || x.payday) return false;
  if (className(x) === "materials:steel") return true;
  return x.category === "Material" && /steel|iron rod|rebar|\brods?\b|\bbrc\b/i.test(`${x.material ?? ""} ${x.description}`) && !/binding wire|nail|bend|machine/i.test(text(x));
}

/** Paid to the steel benders: their class, Wonder, or "steel bending labour" (never the bending machines' hire). */
export function isSteelLabour(x: Expense): boolean {
  if (x.kind !== "expense" || x.forWho !== "Site") return false;
  if (/machine|rental|\bhire\b/i.test(`${x.description} ${x.material ?? ""}`)) return false;
  if (className(x).startsWith("labour:steel")) return true;
  return /\bwonder\b/i.test(x.supplier) || /steel bend|bending labou?r|steel bender/i.test(`${x.description} ${x.supplier}`);
}

/** A payment towards steel already counted (the rest of a delivery's price): no tons of its own. */
const PART_PAYMENT = /final payment|part payment|\bbalance\b|instal|second payment|remaining|top.?up/i;

/**
 * The steel summary. `unitOf` gives the store room's unit for a material ("tons"), so a quantity can be read as
 * tons; `rate` is the labour per ton bent and installed.
 */
export function steelSummary(expenses: readonly Expense[], rate: number, unitOf: (material: string) => string | null = () => null): SteelSummary {
  const bought: SteelBuy[] = [];
  const labour: SteelPay[] = [];
  for (const x of expenses) {
    if (isSteelBuy(x)) {
      let tons: number | null = null;
      let how: SteelBuy["how"] = "unknown";
      if (typeof x.steelTons === "number") {
        tons = x.steelTons;
        how = "typed";
      } else if (PART_PAYMENT.test(x.description)) {
        tons = 0;
        how = "part payment";
      } else if (x.qty && (/\btons?\b/i.test(text(x)) || /^tons?$/i.test(unitOf(x.material ?? "") ?? ""))) {
        tons = x.qty;
        how = "quantity";
      }
      bought.push({ id: x.id, ref: x.ref, date: x.date, supplier: x.supplier, description: x.description || (x.material ?? ""), amount: x.amount, tons, how });
    } else if (isSteelLabour(x)) {
      labour.push({ id: x.id, ref: x.ref, date: x.date, supplier: x.supplier, description: x.description, amount: x.amount });
    }
  }
  const byDate = (a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date);
  bought.sort(byDate);
  labour.sort(byDate);
  const tons = Math.round(bought.reduce((n, b) => n + (b.tons ?? 0), 0) * 1000) / 1000;
  const paid = Math.round(labour.reduce((n, l) => n + l.amount, 0) * 100) / 100;
  const labourValue = Math.round(tons * rate * 100) / 100;
  return { rate, tons, unknown: bought.filter((b) => b.tons === null).length, labourValue, paid, balance: Math.round((labourValue - paid) * 100) / 100, bought, labour };
}

/* ---------- tons installed (the steel tracker, /todo/steel) ---------- */
// Niko, 2 Nov 2026: "now build the steel tracker properly with tons installed". Wonder is paid by the ton bent and
// installed, so what is owed comes from the tons installed (logged on the steel page), not the tons bought: the
// labour earned is the tons installed at the rate a ton, less what the steel benders were paid. The steel bought
// and not yet installed is what's in stock (and its labour still to come).

export const STEEL_PARTS = ["Footings", "Columns", "Beams", "Slab", "Stairs", "Walls", "Other"] as const;

export interface SteelInstall {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  /** The floor or location ("First Floor", "Foundations"). */
  area: string;
  /** What was bent and installed: columns, a slab... */
  part: string;
  tons: number;
  note: string;
  createdBy: string;
  createdAt: string;
}

export interface SteelTracker extends SteelSummary {
  installed: number;
  /** Bought less installed (below 0: more installed than the buys say). */
  stock: number;
  /** The tons installed at the rate a ton. */
  earned: number;
  /** Earned less paid: owed to the steel benders (below 0: paid ahead). */
  owed: number;
  /** The labour on the steel in stock, still to come. */
  toCome: number;
  installs: SteelInstall[];
}

export function steelTracker(summary: SteelSummary, installs: readonly SteelInstall[]): SteelTracker {
  const round = (n: number, d = 100) => Math.round(n * d) / d;
  const installed = round(installs.reduce((n, i) => n + i.tons, 0), 1000);
  const stock = round(summary.tons - installed, 1000);
  const earned = round(installed * summary.rate);
  return {
    ...summary,
    installed,
    stock,
    earned,
    owed: round(earned - summary.paid),
    toCome: round(Math.max(stock, 0) * summary.rate),
    installs: [...installs].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
  };
}

/** The steel page's data (lib/steel/server.ts): the tracker, and where steel goes (the books' locations and the floors). */
export interface SteelData {
  tracker: SteelTracker;
  areas: string[];
}
