import type { CATEGORIES, METHODS } from "@/lib/expenses/shared";

// The field names of the expenses-feed form on /admin/quickbooks, shared by the page and its route.

/** The field for each "Paid by": pay_cash, pay_momo, pay_card, pay_bank_transfer. */
export const payField = (m: (typeof METHODS)[number]) => `pay_${m.toLowerCase().replace(/\s+/g, "_")}`;
/** The class for each kind of expense: class_material, class_service, class_other. */
export const classField = (c: (typeof CATEGORIES)[number]) => `class_${c.toLowerCase()}`;
/** How many "money in from ... goes to ..." rows the form has. */
export const RULE_ROWS = 3;
