import { PART_PAYMENT } from "@/lib/expenses/steel";

// Analysis (Niko, 7 Nov 2026: "Add a financial analysis tab under finance, and in there do your own analysis of how
// its going. and put do your best to add up all the materials we've bought, like plywood, 2x4, etc. i want to see how
// many pieces I've bought of everything"). Read from the same spending as the Spending tab (QuickBooks' transactions
// and the app's own not there yet, nothing twice), line by line: each cost put in a group (steel, concrete, wood,
// labour...), the materials counted from what was typed (the app's material and quantity) or written (QuickBooks'
// "Kalushia 150pcs 2x4 wood"), the prices a unit over time, the weeks since the app's records began against the money
// that came in, and what looks entered twice. Shared by the server (which works it out) and the phone (which shows it).

/** One cost line: one line of a QuickBooks transaction, or one of the app's own entries not in QuickBooks yet. */
export interface CostLine {
  /** The entry it's on ("qbo:Purchase:12", "app:expense-live-…", "bill:bill-live-…"). */
  entry: string;
  kind: "expense" | "bill" | "credit";
  date: string;
  supplier: string;
  /** Costs positive; a credit negative. */
  amount: number;
  /** The QuickBooks class (cost type) when it has one. */
  cls: string | null;
  /** What it says: the line's description, or the app's material and description. */
  text: string;
  /** The floor or stage in the app's words, or null. */
  floor: string | null;
  /** The app's own materials on it as typed (name, quantity, the store room's unit); null: read from the text. */
  typed: TypedMaterial[] | null;
  /** The app's category for it ("Material", "Service", "Other"), when it's the app's. */
  category: string | null;
  /** Wages (or the steel machines) paid in Payday. */
  payday: "workers" | "machines" | null;
  /** Tons typed for it on the steel page, when typed. */
  steelTons: number | null;
  /** EXP-0012, BILL-0003: the app's own number, when it has one. */
  ref: string | null;
}

export interface TypedMaterial {
  name: string;
  qty: number;
  /** The store room's unit for it ("bags", "tons"), when it's a store item. */
  unit: string | null;
}

/* ---------- groups ---------- */

export const GROUPS = [
  "Steel",
  "Concrete",
  "Wood & formwork",
  "Cement, sand & stone",
  "Other materials",
  "Labour",
  "Equipment hire",
  "Tools",
  "Transport & fuel",
  "Other costs",
  "Not sorted",
] as const;
export type Group = (typeof GROUPS)[number];
const MATERIAL_GROUPS: readonly Group[] = ["Steel", "Concrete", "Wood & formwork", "Cement, sand & stone", "Other materials"];
export const isMaterialGroup = (g: Group) => MATERIAL_GROUPS.includes(g);

/** QuickBooks' classes (cost types), first match wins; any other class is an other cost. */
const CLASS_GROUPS: [RegExp, Group][] = [
  [/^materials:steel/i, "Steel"],
  [/^concrete/i, "Concrete"],
  [/^materials:wood/i, "Wood & formwork"],
  [/^materials:(cement|sand|rocks|blocks)/i, "Cement, sand & stone"],
  [/^materials/i, "Other materials"],
  [/^(labour|supervisor|specialists)/i, "Labour"],
  [/^equipment/i, "Equipment hire"],
  [/^tools/i, "Tools"],
  [/^(transport|fuel)/i, "Transport & fuel"],
];

/** Without a class: by what it (or who was paid) says, first match wins (the steel benders' pay is labour, not steel). */
const WORD_GROUPS: [RegExp, Group][] = [
  [/rental|\bhire\b|\brent\b|\bjacks?\b|\bprops?\b|excavator|backhoe|compactor|machine/i, "Equipment hire"],
  [/transport|diesel|\bfuel\b|petrol|delivery/i, "Transport & fuel"],
  [/labou?r|payroll|wages?|salary|monthly pay|weekly pay|\bbonus\b|pay for last week|\bworkers\b|bending|bender|plumb|electric|weld|carpent|mason|surveyor|engineer|architect/i, "Labour"],
];
const TOOL_WORDS = /\btools?\b|drill|grinder|chisel|vibrator|\bpump\b|wheelbarrow|\bhose\b|\bbits?\b|shovel|headpan|clamps?|\blamp\b|cutting discs?/i;
const MATERIAL_WORDS = /pipes?\b|fittings|admix|sealant|waterproof|\bfoam\b|paint|silicone|\bglue\b|conduit|hardware|\bmaterials?\b/i;

/** The group of a cost line: its class, else what it says, else who was paid ("Payroll", "Wonder"), else the app's category. */
export function groupOf(line: Pick<CostLine, "cls" | "text" | "typed" | "category" | "payday" | "supplier">): Group {
  if (line.payday) return line.payday === "machines" ? "Equipment hire" : "Labour";
  if (line.cls) return CLASS_GROUPS.find(([re]) => re.test(line.cls!))?.[1] ?? "Other costs";
  const typed = line.typed?.[0] ? materialOf(line.typed[0].name) : null;
  if (typed) return typed.group;
  for (const [re, group] of WORD_GROUPS) if (re.test(line.text)) return group;
  const named = materialsIn(line.text)[0];
  if (named) return named.group;
  if (TOOL_WORDS.test(line.text)) return "Tools";
  if (line.category === "Material" || MATERIAL_WORDS.test(line.text)) return "Other materials";
  for (const [re, group] of WORD_GROUPS) if (re.test(line.supplier)) return group;
  return line.category ? "Other costs" : "Not sorted";
}

/* ---------- materials ---------- */

export interface Material {
  key: string;
  name: string;
  /** What it's counted in. */
  unit: string;
  group: Group;
  words: RegExp;
  /** Words that say it's something else ("cement mixer"). */
  not?: RegExp;
}

/** The materials the analysis counts by name, in the order a line is read (2x4 before wawa: "2 x4 wood wawa"). */
export const MATERIALS: readonly Material[] = [
  { key: "steel", name: "Steel", unit: "tons", group: "Steel", words: /\bsteel\b|\brebars?\b|\biron rods?\b|high tensile/i, not: /bend|machine|transport|labou?r|clamp|cutting|drawing/i },
  {
    key: "concrete",
    name: "Ready-mix concrete",
    unit: "m³",
    group: "Concrete",
    words: /ready ?mix|\bconcrete\b|\bcbm\b/i,
    not: /waterproof|additive|admix|vibrator|chisel|mould|cube|\btest|mixer|machine|\bstop\b/i,
  },
  { key: "plywood", name: "Plywood", unit: "pcs", group: "Wood & formwork", words: /\bpl[yi] ?wood|\bpkywood|marine ply/i },
  { key: "2x4", name: "2x4 wood", unit: "pcs", group: "Wood & formwork", words: /\b2 ?(?:x|×|\/) ?4(?!\d)/i },
  { key: "wawa", name: "Wawa boards", unit: "pcs", group: "Wood & formwork", words: /\bwawa\b/i, not: /\b2 ?(?:x|×|\/) ?4(?!\d)/i },
  { key: "cement", name: "Cement", unit: "bags", group: "Cement, sand & stone", words: /\bcement\b/i, not: /mixer|machine|transport/i },
  { key: "sand", name: "Sand", unit: "truck loads", group: "Cement, sand & stone", words: /\bsand\b/i },
  { key: "stone", name: "Chippings, 0-40, boulders, laterite", unit: "truck loads", group: "Cement, sand & stone", words: /chipping|\b0 ?- ?40\b|quarry dust|boulders?|laterite/i },
  { key: "blocks", name: "Blocks", unit: "pcs", group: "Cement, sand & stone", words: /\bblocks?\b/i },
  { key: "binding", name: "Binding wire", unit: "rolls", group: "Other materials", words: /binding wire/i },
  { key: "nails", name: "Nails", unit: "boxes", group: "Other materials", words: /\bnails?\b/i },
  { key: "dpm", name: "DPM membrane", unit: "rolls", group: "Other materials", words: /\bdpm\b|damp ?proof|membrane|dimple mat/i },
  { key: "roofing", name: "Roofing sheets", unit: "pcs", group: "Other materials", words: /roofing sheets?/i },
  { key: "sacks", name: "Jute sacks", unit: "pcs", group: "Other materials", words: /\bjute\b|burlap|\bsacks?\b/i },
  { key: "grout", name: "Non-shrink grout", unit: "bags", group: "Other materials", words: /\bgrout\b/i },
  { key: "chicken", name: "Chicken wire", unit: "pcs", group: "Other materials", words: /chicken wire/i },
];

const matches = (m: Material, text: string) => m.words.test(text) && !m.not?.test(text);
/** The materials a line names, in the order above. */
export const materialsIn = (text: string) => MATERIALS.filter((m) => matches(m, text));
/** A typed material's place in the list ("21mm Marine Plywood" is plywood), or null: counted under its own name. */
export const materialOf = (name: string) => MATERIALS.find((m) => matches(m, name)) ?? null;
/** The material a QuickBooks class stands for, when the words don't name it ("25 bags 42.5r afranie" is cement). */
const CLASS_MATERIALS: [RegExp, string][] = [
  [/^materials:steel/i, "steel"],
  [/^concrete/i, "concrete"],
  [/^materials:cement/i, "cement"],
  [/^materials:blocks/i, "blocks"],
  [/^materials:damp/i, "dpm"],
  [/^materials:rocks/i, "stone"],
];
const classMaterial = (cls: string | null) => {
  const key = cls ? CLASS_MATERIALS.find(([re]) => re.test(cls))?.[1] : undefined;
  return key ? (MATERIALS.find((m) => m.key === key) ?? null) : null;
};

const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, half: 0.5, a: 1 };
const NUMBER = String.raw`(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|half)`;
/** How each unit is written after a number ("150pcs", "20 bags", "42+5cbm", "8 trips", "one more roll"). */
const UNIT_WORDS: Record<string, string> = {
  pcs: String.raw`(?:pcs?|pieces?|boards?|sheets?|lengths?)\b`,
  bags: String.raw`bags?\b`,
  tons: String.raw`(?:tons?|tonnes?)\b`,
  "m³": String.raw`(?:cbm|m3|m³|cubic)`,
  rolls: String.raw`(?:rolls?|pcs?)\b`,
  boxes: String.raw`(?:boxes|box|packets?)\b`,
  "truck loads": String.raw`(?:truck ?loads?|trucks?|trips?|loads?|tippers?)\b`,
};
const toNumber = (s: string) => WORD_NUMBERS[s.toLowerCase()] ?? Number(s.replace(",", "."));

/**
 * How many of a material a line's words say were bought, in its unit ("Kalushia 150pcs 2x4" is 150 of 2x4, "Consar
 * 42+5cbm" 47 m³, "half truck" 0.5), or null when no number is written for it. The amount a description starts with
 * ("10200 Kalushia wood 100pcs 2x4") isn't a count, and neither are sizes (4" nails, 18mm, 300 micron, c35, 42.5r).
 */
export function countIn(text: string, m: Material, amount: number): number | null {
  let t = ` ${text.toLowerCase().replace(/×/g, "x")} `;
  // The amount it starts with, as typed in the sheet ("10,000 16mm steel", "777.86 UCT").
  const lead = /^\s*(\d[\d,]*(?:\.\d+)?)\s/.exec(t);
  if (lead && Math.abs(Number(lead[1].replace(/,/g, "")) - Math.abs(amount)) < 1) t = ` ${t.slice(lead[0].length)}`;
  const unit = UNIT_WORDS[m.unit];
  if (unit) {
    const found = [...t.matchAll(new RegExp(String.raw`(?<![\w.])${NUMBER}(?:\s*\+\s*(\d+(?:\.\d+)?))?\s*(?:more\s+|extra\s+)?${unit}`, "gi"))]
      // "3500 per truck", "11000 per ton": a price, not a count.
      .filter((x) => !/^\s*per\b/.test(t.slice(Math.max(0, (x.index ?? 0) - 5), x.index)))
      .map((x) => toNumber(x[1]) + (x[2] ? Number(x[2]) : 0))
      .filter((n) => n > 0 && n < 100_000);
    // Two of a kind on one line ("5 boxes 4" nails and 5 boxes 3" nails") add up.
    if (found.length) return Math.round(found.reduce((a, b) => a + b, 0) * 1000) / 1000;
  }
  // "2x4 Wood x 100", "wood x 40".
  const times = /(?:^|\s)x\s?(\d+(?:\.\d+)?)\b/.exec(t);
  if (times) return Number(times[1]);
  // "10 plywood", "20 bags of cement" without the unit: a number right before its name (not a size).
  const before = new RegExp(String.raw`(?<![\w."”″'/-])(\d+(?:\.\d+)?)\s+(?:of\s+)?(?:\w+\s+)?(?=${m.words.source})`, "i").exec(t);
  if (before && !/^\d+(?:\.\d+)?\s*(?:mm|inch|in|"|”|″|')/.test(before[0])) return Number(before[1]);
  // "Dan chippings truckload", "one more roll": one.
  if (m.unit === "truck loads" && /\btruck ?load\b|\btruck\b/.test(t)) return 1;
  return null;
}

/** A payment towards goods already counted (the rest of an order's price): none of its own. */
export const isPartPayment = (text: string) => PART_PAYMENT.test(text);

/* ---------- the tally ---------- */

export interface MaterialBuy {
  entry: string;
  date: string;
  supplier: string;
  amount: number;
  text: string;
  /** How many it brought (the material's unit); null: not written; 0: a payment towards goods counted before. */
  count: number | null;
  /** Counted with another payment for the same goods (paid in two parts): that one's entry. */
  partOf: string | null;
  /** Other materials on the same line (one bill for plywood and 2x4): its money is with the first. */
  with: string[];
}

export interface MaterialRow {
  key: string;
  name: string;
  unit: string;
  group: Group;
  /** Counted from what was typed or written. */
  count: number;
  /** All the money on it. */
  money: number;
  /** The average price a unit, from the purchases with a count (null: none). */
  price: number | null;
  /** The money of purchases with no count written... */
  unknownMoney: number;
  /** ...and about how many more that is at the average price (null: no price to go by). */
  estimate: number | null;
  buys: MaterialBuy[];
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
const sameSupplier = (a: string, b: string) => {
  const wa = words(a);
  const wb = new Set(words(b));
  return wa.length > 0 && wa.some((w) => wb.has(w));
};
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const daysApart = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/**
 * Every material bought, counted: the app's typed materials (name and quantity), else what QuickBooks' words say.
 * Only lines whose group is a material's count (the steel benders' pay mentions steel too). A payment of the rest of
 * an order counts none ("final payment for the 26 tons"), and two payments for the same goods (one supplier, the
 * same material and number, within two weeks, each too cheap on its own: 70 plywood paid 15,000 then 22,300) count
 * once. The average price comes from the purchases with a count; the money with none is shown with about how many
 * that is.
 */
export function materialTally(lines: readonly CostLine[]): MaterialRow[] {
  const rows = new Map<string, MaterialRow>();
  const rowFor = (m: Material | { key: string; name: string; unit: string; group: Group }) => {
    let row = rows.get(m.key);
    if (!row) {
      row = { key: m.key, name: m.name, unit: m.unit, group: m.group, count: 0, money: 0, price: null, unknownMoney: 0, estimate: null, buys: [] };
      rows.set(m.key, row);
    }
    return row;
  };
  for (const line of lines) {
    if (line.kind === "credit" || line.amount <= 0) continue;
    const group = groupOf(line);
    if (!isMaterialGroup(group)) continue;
    const part = isPartPayment(line.text);
    const base = { entry: line.entry, date: line.date, supplier: line.supplier, text: line.text, partOf: null };
    if (line.typed?.length) {
      // The app's own: each material as typed, the money with the first.
      line.typed.forEach((t, i) => {
        const m = materialOf(t.name);
        const own = m ?? { key: `typed:${t.name.trim().toLowerCase()}`, name: t.name.trim(), unit: t.unit || "pcs", group };
        const count = part ? 0 : m?.key === "steel" && line.steelTons !== null && i === 0 ? line.steelTons : t.qty;
        rowFor(own).buys.push({ ...base, amount: i === 0 ? line.amount : 0, count, with: i === 0 ? line.typed!.slice(1).map((x) => x.name) : [] });
      });
      continue;
    }
    const said = materialsIn(line.text);
    const fromClass = classMaterial(line.cls);
    const named = said.length ? said : fromClass ? [fromClass] : [];
    if (!named.length) continue;
    // The money goes with the first material named that has a count, else the first.
    const lead = named.find((x) => countIn(line.text, x, line.amount) !== null) ?? named[0];
    for (const m of named) {
      const count = part ? 0 : m.key === "steel" && line.steelTons !== null ? line.steelTons : countIn(line.text, m, line.amount);
      rowFor(m).buys.push({ ...base, amount: m === lead ? line.amount : 0, count, with: named.filter((x) => x !== m).map((x) => x.name) });
    }
  }
  for (const row of rows.values()) {
    row.buys.sort((a, b) => a.date.localeCompare(b.date) || a.entry.localeCompare(b.entry));
    // The price to judge "too cheap on its own" by: the middle price of the other purchases with a count.
    const single = row.buys.filter((b) => b.count && b.amount > 0 && !b.with.length);
    const usual = (but: readonly MaterialBuy[]) => {
      const prices = single.filter((b) => !but.includes(b)).map((b) => b.amount / b.count!);
      return prices.length ? prices.sort((x, y) => x - y)[Math.floor(prices.length / 2)] : null;
    };
    for (let i = 0; i < row.buys.length; i++) {
      const a = row.buys[i];
      if (!a.count || a.partOf || a.with.length) continue;
      for (let j = i + 1; j < row.buys.length; j++) {
        const b = row.buys[j];
        if (daysApart(a.date, b.date) > 14) break;
        if (b.partOf || b.count !== a.count || b.with.length || !sameSupplier(a.supplier || a.text, b.supplier || b.text)) continue;
        const middle = usual([a, b]);
        const together = (a.amount + b.amount) / a.count;
        if (middle && a.amount / a.count < middle * 0.8 && b.amount / b.count < middle * 0.8 && together > middle * 0.7 && together < middle * 1.4) {
          b.partOf = a.entry;
          break;
        }
      }
    }
    row.count = round(row.buys.reduce((n, b) => n + (b.partOf ? 0 : (b.count ?? 0)), 0), 3);
    row.money = round(row.buys.reduce((n, b) => n + b.amount, 0));
    const priced = row.buys.filter((b) => b.count !== null && !b.with.length);
    const pricedCount = priced.reduce((n, b) => n + (b.partOf ? 0 : (b.count ?? 0)), 0);
    const pricedMoney = priced.reduce((n, b) => n + b.amount, 0);
    row.price = pricedCount > 0 ? round(pricedMoney / pricedCount) : null;
    row.unknownMoney = round(row.buys.filter((b) => b.count === null).reduce((n, b) => n + b.amount, 0));
    row.estimate = row.price && row.unknownMoney > 0 ? round(row.unknownMoney / row.price, row.unit === "pcs" || row.unit === "bags" ? 0 : 1) : null;
  }
  return [...rows.values()].filter((r) => r.buys.length).sort((a, b) => b.money - a.money || a.name.localeCompare(b.name));
}

/**
 * A material's price a unit then and now: the first three purchases with a count against the last three (two paid in
 * parts as one). A price far from the usual one is left out: a first part paid on delivery (26 tons for 100,000, the
 * rest paid later), or a few pieces with their transport.
 */
export function priceTrend(row: MaterialRow): { first: number; last: number; firstDate: string; lastDate: string; change: number } | null {
  const buys = row.buys
    .filter((b) => b.count && !b.with.length && !b.partOf)
    .map((b) => ({ ...b, paid: b.amount + row.buys.filter((x) => x.partOf === b.entry).reduce((n, x) => n + x.amount, 0) }))
    .filter((b) => b.paid > 0);
  const each = buys.map((b) => b.paid / b.count!).sort((a, b) => a - b);
  const middle = each[Math.floor(each.length / 2)];
  const priced = buys.filter((b) => b.paid / b.count! > middle * 0.6 && b.paid / b.count! < middle * 1.6);
  if (priced.length < 4) return null;
  const avg = (bs: typeof priced) => bs.reduce((n, b) => n + b.paid, 0) / bs.reduce((n, b) => n + (b.count ?? 0), 0);
  const n = Math.min(3, Math.floor(priced.length / 2));
  const first = avg(priced.slice(0, n));
  const last = avg(priced.slice(-n));
  return { first: round(first), last: round(last), firstDate: priced[0].date, lastDate: priced[priced.length - 1].date, change: round(((last - first) / first) * 100, 1) };
}

/* ---------- adding up ---------- */

export interface GroupRow {
  name: Group;
  amount: number;
  count: number;
}
/** What was spent in each group, biggest first. */
export function byGroup(lines: readonly CostLine[]): GroupRow[] {
  const map = new Map<Group, GroupRow>();
  for (const l of lines) {
    const name = groupOf(l);
    const row = map.get(name) ?? { name, amount: 0, count: 0 };
    row.amount = round(row.amount + l.amount);
    row.count++;
    map.set(name, row);
  }
  return [...map.values()].filter((r) => Math.abs(r.amount) >= 0.005).sort((a, b) => b.amount - a.amount);
}

export interface MonthRow {
  /** YYYY-MM */
  month: string;
  amount: number;
  /** Of which steel and concrete (the big buys of a floor). */
  big: number;
}
const isBig = (l: CostLine) => {
  const g = groupOf(l);
  return g === "Steel" || g === "Concrete";
};
const nextMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
};
/** Month by month, oldest first, the months with nothing included (so a gap shows). */
export function byMonth(lines: readonly CostLine[]): MonthRow[] {
  const map = new Map<string, MonthRow>();
  for (const l of lines) {
    const month = l.date.slice(0, 7);
    const row = map.get(month) ?? { month, amount: 0, big: 0 };
    row.amount = round(row.amount + l.amount);
    if (isBig(l)) row.big = round(row.big + l.amount);
    map.set(month, row);
  }
  const months = [...map.keys()].sort();
  const out: MonthRow[] = [];
  for (let m = months[0]; m && m <= months[months.length - 1]; m = nextMonth(m)) out.push(map.get(m) ?? { month: m, amount: 0, big: 0 });
  return out;
}

/** The Monday of a day's week (YYYY-MM-DD). */
export const mondayOf = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
const plusDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Money that came in (the app's money in, the company's), as the analysis needs it. */
export interface MoneyIn {
  date: string;
  amount: number;
  /** Who it came from: Leo, a buyer ("Dr. Michael E. Gyasi (buyer)"), or someone else. */
  from: "leo" | "buyer" | "other";
}
export const moneyFrom = (supplier: string): MoneyIn["from"] => (/\(buyer\)/i.test(supplier) ? "buyer" : /\bleo\b/i.test(supplier) ? "leo" : "other");

export interface WeekRow {
  /** Its Monday. */
  start: string;
  spent: number;
  /** Of which steel and concrete. */
  big: number;
  in: number;
  leo: number;
  buyers: number;
}
/** Week by week from the week the app's money records begin (`from`) to this week. */
export function byWeek(lines: readonly CostLine[], ins: readonly MoneyIn[], from: string, today: string): WeekRow[] {
  const out: WeekRow[] = [];
  for (let w = mondayOf(from); w <= today; w = plusDays(w, 7)) out.push({ start: w, spent: 0, big: 0, in: 0, leo: 0, buyers: 0 });
  const at = new Map(out.map((w) => [w.start, w]));
  for (const l of lines) {
    const w = at.get(mondayOf(l.date));
    if (!w) continue;
    w.spent = round(w.spent + l.amount);
    if (isBig(l)) w.big = round(w.big + l.amount);
  }
  for (const m of ins) {
    const w = at.get(mondayOf(m.date));
    if (!w) continue;
    w.in = round(w.in + m.amount);
    if (m.from === "leo") w.leo = round(w.leo + m.amount);
    if (m.from === "buyer") w.buyers = round(w.buyers + m.amount);
  }
  return out;
}

/* ---------- worth checking ---------- */

/** A supplier's own words, not the trade's ("K Afranie Steel" is "afranie"). */
const GENERIC = new Set(
  (
    "steel cement timber wood hardware building materials material equipment rental traders trader enterprise enterprises ltd limited " +
    "company group bros brothers pro heavy construction plumber electrician mason carpenter contractor supervisor assistant truck " +
    "foreman blocks sand chippings concrete services service the and for okponglo"
  ).split(" ")
);
const ownWords = (s: string) => words(s).filter((w) => !GENERIC.has(w) && !/^\d+$/.test(w));
const sameName = (a: CostLine, b: CostLine) => {
  const inA = new Set([...ownWords(a.supplier), ...ownWords(a.text)]);
  const inB = new Set([...ownWords(b.supplier), ...ownWords(b.text)]);
  return ownWords(a.supplier).some((w) => inB.has(w)) || ownWords(b.supplier).some((w) => inA.has(w));
};

type Brief = Pick<CostLine, "entry" | "date" | "supplier" | "amount" | "text" | "ref">;
export interface Double {
  /** The bill, and the expense for the same amount. */
  a: Brief;
  b: Brief;
  amount: number;
}
/**
 * What looks counted twice: a supplier's bill and an expense paid to the same supplier for the same amount within ten
 * days (Afranie's 6 tons: a bill paid in May, and the same 56,000 as cash on 2 May). If the expense paid the bill, it
 * should be the bill's payment, or the cost counts twice. GH₵ 1,000 or more only.
 */
export function doublesOf(lines: readonly CostLine[]): Double[] {
  const brief = (l: CostLine): Brief => ({ entry: l.entry, date: l.date, supplier: l.supplier, amount: l.amount, text: l.text, ref: l.ref });
  const paid = lines.filter((l) => l.kind === "expense" && l.amount >= 1000);
  const out: Double[] = [];
  for (const bill of lines.filter((l) => l.kind === "bill" && l.amount >= 1000)) {
    const twin = paid.find((x) => Math.abs(x.amount - bill.amount) < 1 && daysApart(x.date, bill.date) <= 10 && sameName(bill, x) && !out.some((d) => d.b.entry === x.entry));
    if (twin) out.push({ a: brief(bill), b: brief(twin), amount: bill.amount });
  }
  return out.sort((a, b) => b.a.date.localeCompare(a.a.date));
}

/** Stretches of two weeks or more with nothing spent recorded at all, from the first steel or concrete (the building's start) to today. */
export function gapsOf(lines: readonly CostLine[], today: string): { from: string; to: string; days: number }[] {
  const start = lines.filter(isBig).map((l) => l.date).sort()[0];
  if (!start) return [];
  const days = [...new Set(lines.map((l) => l.date))].filter((d) => d >= start && d <= today).sort();
  const out: { from: string; to: string; days: number }[] = [];
  for (let i = 1; i < days.length; i++) {
    const gap = daysApart(days[i - 1], days[i]) - 1;
    if (gap >= 14) out.push({ from: days[i - 1], to: days[i], days: gap });
  }
  return out;
}

/* ---------- the page ---------- */

/** The materials whose price a unit is followed, in this order. */
export const PRICE_KEYS = ["steel", "concrete", "plywood", "2x4", "cement", "wawa"] as const;

export interface AnalysisData {
  today: string;
  /** Everything spent (as the Spending tab adds it up), and since when. */
  spent: number;
  first: string | null;
  groups: GroupRow[];
  months: MonthRow[];
  /** By floor or stage in the app's words ("1st floor", "Foundations"), biggest first. */
  floors: { name: string; amount: number }[];
  /** Since the app's money records began: week by week, and in all. */
  weeks: WeekRow[];
  since: { from: string; spent: number; in: number; leo: number; buyers: number } | null;
  materials: MaterialRow[];
  /** The main materials' price a unit, then and now. */
  prices: ({ key: string; name: string; unit: string } & NonNullable<ReturnType<typeof priceTrend>>)[];
  doubles: Double[];
  gaps: { from: string; to: string; days: number }[];
  /** The Cash flow tab's own outlook, or null when it can't be worked out. */
  cash: {
    now: number | null;
    typedAt: string | null;
    short: { date: string; amount: number } | null;
    lowest: { amount: number; date: string } | null;
    leoWeekly: number | null;
    wagesWeekly: number | null;
  } | null;
  fetchedAt: string | null;
  connected: boolean;
}
