import type { CostClass } from "@/lib/quickbooks/books";

// Site expenses (/todo/expenses), the office only. Moved here from the Claude page "Site Expense
// Log" (Niko's since 29 Sep 2026) so it sits beside the to-do list and the store room: a paid
// Material purchase for the Site goes straight into the store room's stock. Niko, 22 Oct 2026:
// "when i get more materials it'll automatically update the inventory tracker".
// 23 Oct 2026: every entry gets a reference (EXP-0001 / IN-0001), VAT can be ticked, and each
// entry goes to its own Google Sheet with the receipt renamed after it ("so they can be easily
// traced and later put into the accounting software (quickbooks online)").

/** The floors the expense log has always used, now up to the 7th (the building's top floor). */
export const FLOORS = [
  "Basement",
  "Ground floor",
  "1st floor",
  "2nd floor",
  "3rd floor",
  "4th floor",
  "5th floor",
  "6th floor",
  "7th floor",
  "Roof",
  "Whole building",
] as const;
export const METHODS = ["Cash", "MoMo", "Card", "Bank transfer"] as const;
export const CATEGORIES = ["Material", "Service", "Other"] as const;
export const FOR_WHO = ["Site", "House", "Niko", "Event"] as const;
export type ForWho = (typeof FOR_WHO)[number];

export const MAX_SUPPLIER = 80;
export const MAX_DESCRIPTION = 300;
export const MAX_MATERIAL = 60;

/**
 * Ghana's VAT from 1 January 2026 (VAT Act 2025, Act 1151): 15% VAT + 2.5% NHIL + 2.5% GETFund,
 * all on the same base and all claimable = 20% of the price before VAT. A shop on a different rate
 * can be typed on the entry itself.
 */
export const VAT_RATE = 20;

export interface Expense {
  id: string;
  /** EXP-0001 for expenses, IN-0001 for money in; what the receipt file and the sheet row carry. */
  ref: string | null;
  /** The day it was paid (or received), YYYY-MM-DD. */
  date: string;
  kind: "expense" | "inflow";
  /** Entries from before the Site / House / Niko / Event buttons count as Site. */
  forWho: ForWho;
  /** What was paid in total (VAT included when there is VAT). */
  amount: number;
  /** VAT is included in the amount (then a receipt is a must). */
  vat: boolean;
  /** The VAT rate in percent for this entry (usually VAT_RATE). */
  vatRate: number | null;
  /** Who was paid; for money in, who it came from. */
  supplier: string;
  description: string;
  /** Site expenses only. */
  floor: string | null;
  method: string | null;
  category: string | null;
  material: string | null;
  qty: number | null;
  /** The store room item this purchase added stock to (when toStore). */
  itemId: string | null;
  toStore: boolean;
  receiptId: string | null;
  receiptUrl: string | null;
  receiptType: string | null;
  /** The receipt's copy in Google Drive, once the sheet has it. */
  driveUrl: string | null;
  /** The bank's own text behind it: money in it added or confirmed, a payment out it confirmed, or a fee it filed. */
  bank: BankNote | null;
  /** The QuickBooks class (cost type) chosen for it; the floor gives its QuickBooks location (lib/quickbooks/books.ts). */
  costClass: CostClass | null;
  /** Wages (or the steel machines) paid in Payday that week: the entry is kept by the roll call, one line per payment. */
  payday: PaydayInfo | null;
  /** Tons of steel this entry brought, when typed on the steel page (lib/expenses/steel.ts); otherwise worked out. */
  steelTons: number | null;
  /** The supplier's bill this pays (lib/suppliers), or null: in QuickBooks it's then that bill's payment. */
  billId: string | null;
  /** Another cost on the same receipt as that entry (transport with the wawa boards): its own entry, its own class. */
  withId: string | null;
  /** More photos with the receipt (3 Nov 2026); the receipt itself stays the first. */
  moreReceipts: { id: string; url: string; type: string }[];
  /** More materials on the same receipt (3 Nov 2026), each into the store room or not; the first is material and qty. */
  moreLines: ExpenseLine[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

/** One more material on an entry (the first is the entry's own material and qty). */
export interface ExpenseLine {
  material: string;
  qty: number;
  /** The store room item it added stock to (when toStore). */
  itemId: string | null;
  toStore: boolean;
}
/** Materials on one entry, and photos with one receipt, at most. */
export const MAX_LINES = 20;
export const MAX_RECEIPTS = 10;

/** Every material on an entry, the first one first. */
/** Other costs on one receipt, each saved as its own entry (transport, loading): how many at most. */
export const MAX_EXTRAS = 5;
export const EXTRA_CATEGORIES = ["Service", "Other"] as const;
export type ExtraCategory = (typeof EXTRA_CATEGORIES)[number];
/** Ready-made words for the usual ones. */
export const EXTRA_WORDS = ["Transport", "Loading", "Delivery"] as const;

export const linesOf = (x: Pick<Expense, "category" | "material" | "qty" | "itemId" | "toStore" | "moreLines">): ExpenseLine[] =>
  x.category === "Material" && x.material ? [{ material: x.material, qty: x.qty ?? 1, itemId: x.itemId, toStore: x.toStore }, ...(x.moreLines ?? [])] : [];
/** The materials in words: "2in nails x 1; 4in nails x 3" (one line: just its name). */
export const materialWords = (x: Pick<Expense, "category" | "material" | "qty" | "itemId" | "toStore" | "moreLines">) => {
  const lines = linesOf(x);
  return lines.length > 1 ? lines.map((l) => `${l.material} x ${l.qty}`).join("; ") : (x.material ?? "");
};

/** One payment made in Payday, as a line of that week's wage entry. */
export interface PaydayLine {
  /** The worker's id in the roll call ("machines" for the steel machines). */
  id: string;
  name: string;
  /** The roll call's trade group ("masonry", "carpentry", "steel"), or "machines": it decides the QuickBooks class. */
  group: string;
  amount: number;
  /** When it was paid. */
  at: string;
  /** The MoMo number or reference it went to, when given. */
  ref: string | null;
}

export interface PaydayInfo {
  /** The pay week's Monday, YYYY-MM-DD. */
  week: string;
  kind: "workers" | "machines";
  lines: PaydayLine[];
}

/** What the bank's text said about an entry (lib/expenses/bankText.ts, bankDebit.ts). */
export interface BankNote {
  /** The bank's time for it, "YYYY-MM-DD HH:MM". */
  at: string;
  /** The account as the text shows it (the bank hides the middle digits). */
  account: string;
  /** The balance the text gave after it. */
  balance: number | null;
  /** The entry was typed already and the text only confirmed it. */
  matched: boolean;
}

export const isInflow = (x: Pick<Expense, "kind">) => x.kind === "inflow";

/**
 * Money out from the bank's own "Debit Alert" text, waiting to be made an expense (lib/expenses/bankDebit.ts).
 * Niko, 30 Oct 2026: "each fidelity alert I receive goes into the app as a pending expense that I can add
 * additional information for and / or photos of receipts. then bank transfer or momo fees are automatically
 * filed in quickbooks."
 */
export interface BankDebit {
  id: string;
  amount: number;
  /** The bank's day and time, YYYY-MM-DD and HH:MM. */
  date: string;
  time: string;
  /** As the text shows it: "1060xxxxxxx13". */
  account: string;
  /** The account Leo pays into (the site's); another of Niko's accounts otherwise. */
  siteAccount: boolean;
  /** "Account to Wallet, Cement" */
  narration: string;
  /** A card payment's shop and place, as the bank writes it. */
  where: string;
  balance: number | null;
  receivedAt: string;
  /** The bank's fees on it, filed by themselves as their own entries. */
  fees: { amount: number; ref: string | null }[];
}

/** "YAZBECK PRO TRADERS LIMEast Legon 288" -> the shop "Yazbeck Pro Traders Ltd" and the place "East Legon 288". */
export function shopOf(where: string): { shop: string; place: string } {
  const first = where.split(",")[0].replace(/\s+/g, " ").trim();
  // The card network's name field (capitals, cut at its length) runs straight into the place: "LIMEast Legon".
  const m = /^([A-Z0-9&.'/\- ]+?)\s*([A-Z][a-z].*)?$/.exec(first);
  const name = (m?.[1] ?? first).trim();
  const titled = name
    .split(" ")
    .map((w) => (/^[A-Z0-9&.'/-]+$/.test(w) && w.length > 1 && !/^\d/.test(w) ? w[0] + w.slice(1).toLowerCase() : w))
    .join(" ")
    .replace(/\s+(?:Lim|Limi|Limit|Limite|Limited|Ltd)\.?$/i, " Ltd");
  return { shop: titled, place: (m?.[2] ?? "").trim() };
}

const WALLET = /^\s*account\s+to\s+wallet\s*,?\s*(.*)$/i;

/** What a debit says, to start the expense form with: how it was paid, who to, what for. */
export function debitGuess(d: Pick<BankDebit, "narration" | "where">, knownSuppliers: readonly string[] = []) {
  // A shop already in the expenses keeps the spelling used there.
  const known = (name: string) => {
    const k = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const first = name.toLowerCase().split(" ")[0];
    return (
      knownSuppliers.find((s) => s.toLowerCase().replace(/[^a-z0-9]/g, "") === k) ??
      knownSuppliers.find((s) => first.length >= 4 && s.toLowerCase().split(" ")[0] === first) ??
      name
    );
  };
  if (d.where) return { method: "Card" as const, supplier: known(shopOf(d.where).shop), description: "" };
  const wallet = WALLET.exec(d.narration);
  if (wallet) return { method: "MoMo" as const, supplier: "", description: wallet[1].trim() };
  if (/transfer|\bgip\b|instant\s*pay|\bach\b/i.test(d.narration)) return { method: "Bank transfer" as const, supplier: "", description: "" };
  return { method: null, supplier: "", description: d.narration.trim() };
}

/** A debit in a few words: "card at Yazbeck Pro Traders Ltd", "to a MoMo wallet (Cement)". */
export function debitWords(d: Pick<BankDebit, "narration" | "where">): string {
  if (d.where) return `card at ${shopOf(d.where).shop}`;
  const wallet = WALLET.exec(d.narration);
  if (wallet) return `to a MoMo wallet${wallet[1].trim() ? ` (${wallet[1].trim()})` : ""}`;
  return d.narration.trim() || "paid out";
}

const round2 = (n: number) => Math.round(n * 100) / 100;
/** The VAT inside an amount that includes it, and the amount before VAT. */
export function vatParts(amount: number, rate: number | null | undefined) {
  const r = Number(rate) || 0;
  const vat = r > 0 ? round2((amount * r) / (100 + r)) : 0;
  return { vat, net: round2(amount - vat) };
}

export const money = (n: number) =>
  "GH₵ " + (Number(n) || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const pad = (n: number) => String(n).padStart(2, "0");
/** Today by the phone's own clock (Ghana is GMT all year), as YYYY-MM-DD. */
export const todayISO = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const fileSafe = (s: string) =>
  s
    .replace(/[\\/:*?"<>|#%\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50)
    .trim();

/**
 * The receipt's file name, so it can be traced from the file alone:
 * "2026-10-23 EXP-0084 Kalushia Hardware GHS 5,430.00 VAT.jpg"
 */
export function receiptFileName(
  x: Pick<Expense, "date" | "ref" | "supplier" | "kind" | "amount" | "vat">,
  type: string | null | undefined
) {
  const ext = type === "application/pdf" ? "pdf" : type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  const who = fileSafe(x.supplier) || (x.kind === "inflow" ? "Money in" : "No supplier");
  const amount = (Number(x.amount) || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${x.date} ${x.ref ?? "no-ref"} ${who} GHS ${amount}${x.vat ? " VAT" : ""}.${ext}`;
}
