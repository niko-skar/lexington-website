// Site expenses (/todo/expenses), the office only. Moved here from the Claude page "Site Expense
// Log" (Niko's since 29 Sep 2026) so it sits beside the to-do list and the store room: a paid
// Material purchase for the Site goes straight into the store room's stock. Niko, 22 Oct 2026:
// "when i get more materials it'll automatically update the inventory tracker".

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

export interface Expense {
  id: string;
  /** The day it was paid (or received), YYYY-MM-DD. */
  date: string;
  kind: "expense" | "inflow";
  /** Entries from before the Site / House / Niko / Event buttons count as Site. */
  forWho: ForWho;
  amount: number;
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
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

export const isInflow = (x: Pick<Expense, "kind">) => x.kind === "inflow";

export const money = (n: number) =>
  "GH₵ " + (Number(n) || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const pad = (n: number) => String(n).padStart(2, "0");
/** Today by the phone's own clock (Ghana is GMT all year), as YYYY-MM-DD. */
export const todayISO = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
