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
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

export const isInflow = (x: Pick<Expense, "kind">) => x.kind === "inflow";

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
