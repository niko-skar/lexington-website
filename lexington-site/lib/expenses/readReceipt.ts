import "server-only";

import { writeWithClaude, type ClaudeContent, type JsonSchema } from "@/lib/ai/claude";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { EXPENSE_PREFIX } from "@/lib/site/ids";
import { TodoError } from "@/lib/todo/server";
import { CATEGORIES, MAX_DESCRIPTION, MAX_MATERIAL, MAX_SUPPLIER, METHODS, todayISO } from "./shared";

// Receipt first (Niko, 27 Oct 2026: "upload a photo of the receipt first and it can automatically
// take the information on it and fill in the rest"). The photo or PDF is already in the receipt
// store (uploaded the moment it's picked); Claude reads it and answers in a fixed shape, and every
// value is checked here before the form sees it. The form only fills what is still empty, and the
// office checks it all before saving: nothing is saved from here.

export interface ReceiptReading {
  readable: boolean;
  date: string | null;
  supplier: string | null;
  supplierTin: string | null;
  invoiceNumber: string | null;
  /** The total paid, in cedis (null when the receipt isn't in cedis: see notes). */
  amount: number | null;
  vat: boolean;
  vatRate: number | null;
  method: (typeof METHODS)[number] | null;
  category: (typeof CATEGORIES)[number] | null;
  material: string | null;
  qty: number | null;
  description: string | null;
  /** What to double-check, in plain words. */
  notes: string[];
}

const SYSTEM = `You read photos and PDFs of receipts, invoices and payment slips for The Lexington, an apartment building under construction in Accra, Ghana. The site office enters each one in its expense app; your answer fills in the form, and the office checks it before saving.

Rules:
- Read only what the document shows. If something isn't on it, or you can't read it with confidence, answer null. Never guess a number, a name or a date.
- Currency: Ghana cedis (GH₵, GHS, GHC, ¢, "cedis") unless the document clearly shows another currency. Give the 3-letter code.
- total: the final amount for the whole document, taxes included (the grand total or amount paid), as a plain number with no commas or signs. Add up the lines only when the document shows no total.
- date: the date of the receipt or invoice, as YYYY-MM-DD. Ghanaian documents write the day first (27/10/2026 is 27 October 2026); read ambiguous dates day-first unless the document shows otherwise.
- vatIncluded: true only when the document shows VAT, NHIL, GETFund or the COVID levy charged on it. vatAmount: those tax lines added together. vatRate: those taxes as a percent of the amount before tax, when shown or computable (Ghana's standard combined rate since 2026 is 20%: 15% VAT + 2.5% NHIL + 2.5% GETFund).
- supplier: the business or person who issued it, by the name it uses (the shop name), short, in Title Case. Reuse the exact spelling from the known suppliers when it is one of them. supplierTin: the supplier's TIN or VAT number when shown. invoiceNumber: the receipt or invoice number.
- paymentMethod: Cash, MoMo (mobile money, e.g. MTN MoMo, Telecel Cash, AT Money), Card or Bank transfer, only when the document says how it was paid.
- category: Material for goods bought (building materials, tools, fittings), Service for work paid for (labour, transport, machine or equipment hire, repairs, fees), Other for anything else (food, airtime, office items).
- material: when the purchase is mainly one material, its short everyday name (e.g. "Cement 50kg bag", "Iron rod 12mm", "Sand"), reusing the name from the known materials when it is the same thing. qty: how many of it, when shown. Otherwise null.
- description: a short note in the office's style, e.g. "40 bags cement", "Excavator hire 1 day", "Transport of blocks" (60 characters at most).
- readable: false when this isn't a receipt, invoice or payment slip, or can't be read at all.
- notes: anything the office should double-check before saving, as one short plain sentence, or null.`;

const nullable = (type: string): JsonSchema => ({ anyOf: [{ type }, { type: "null" }] });

const SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    readable: { type: "boolean" },
    date: nullable("string"),
    supplier: nullable("string"),
    supplierTin: nullable("string"),
    invoiceNumber: nullable("string"),
    total: nullable("number"),
    currency: nullable("string"),
    vatIncluded: { type: "boolean" },
    vatAmount: nullable("number"),
    vatRate: nullable("number"),
    paymentMethod: { anyOf: [{ type: "string", enum: [...METHODS] }, { type: "null" }] },
    category: { anyOf: [{ type: "string", enum: [...CATEGORIES] }, { type: "null" }] },
    material: nullable("string"),
    qty: nullable("number"),
    description: nullable("string"),
    notes: nullable("string"),
  },
  required: [
    "readable",
    "date",
    "supplier",
    "supplierTin",
    "invoiceNumber",
    "total",
    "currency",
    "vatIncluded",
    "vatAmount",
    "vatRate",
    "paymentMethod",
    "category",
    "material",
    "qty",
    "description",
    "notes",
  ],
  additionalProperties: false,
};

interface RawReading {
  readable: boolean;
  date: string | null;
  supplier: string | null;
  supplierTin: string | null;
  invoiceNumber: string | null;
  total: number | null;
  currency: string | null;
  vatIncluded: boolean;
  vatAmount: number | null;
  vatRate: number | null;
  paymentMethod: string | null;
  category: string | null;
  material: string | null;
  qty: number | null;
  description: string | null;
  notes: string | null;
}

const MAX_BYTES = 4_500_000;

/**
 * Where a stored receipt can be fetched, worked out from its asset id (image-<sha1>-<w>x<h>-<ext>,
 * file-<sha1>-pdf) rather than looked up: the form asks for the reading the moment the upload
 * answers, before a lookup would find the new file.
 */
function receiptFile(id: unknown): { url: string; type: "image/jpeg" | "image/png" | "image/webp" | "application/pdf" } {
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
  const dataset = process.env.NEXT_PUBLIC_SANITY_BUYERS_DATASET;
  const image = typeof id === "string" ? /^image-([a-f0-9]{40})-(\d+x\d+)-(jpg|png|webp)$/.exec(id) : null;
  const file = typeof id === "string" ? /^file-([a-f0-9]{40})-pdf$/.exec(id) : null;
  if ((!image && !file) || !projectId || !dataset) throw new TodoError(400, "Add the receipt first.");
  if (image) {
    const ext = image[3];
    return { url: `https://cdn.sanity.io/images/${projectId}/${dataset}/${image[1]}-${image[2]}.${ext}`, type: ext === "jpg" ? "image/jpeg" : (`image/${ext}` as "image/png" | "image/webp") };
  }
  return { url: `https://cdn.sanity.io/files/${projectId}/${dataset}/${file![1]}.pdf`, type: "application/pdf" };
}

const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) || null : null);
const positive = (value: unknown, max: number) => (typeof value === "number" && Number.isFinite(value) && value > 0 && value <= max ? value : null);

/** Claude's answer, checked: a bad date, a silly amount or an unknown choice becomes "not read". */
function clean(raw: RawReading): ReceiptReading {
  const notes: string[] = [];
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const date =
    typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) && !Number.isNaN(Date.parse(raw.date + "T00:00:00Z")) && raw.date >= "2020-01-01" && raw.date <= todayISO(tomorrow)
      ? raw.date
      : null;
  if (raw.date && !date) notes.push(`The date on it (${raw.date}) doesn't look right: pick the date yourself.`);

  const total = positive(raw.total, 100_000_000);
  const currency = (raw.currency ?? "GHS").trim().toUpperCase();
  const cedis = ["GHS", "GHC", "GH¢", "GH₵", "CEDI", "CEDIS"].includes(currency);
  const amount = total && cedis ? Math.round(total * 100) / 100 : null;
  if (total && !cedis) notes.push(`The receipt is in ${currency} (${total.toLocaleString("en-GB")}): enter the amount paid in cedis.`);

  const vatRate = positive(raw.vatRate, 50);
  const method = METHODS.find((m) => m === raw.paymentMethod) ?? null;
  const category = CATEGORIES.find((c) => c === raw.category) ?? null;
  if (raw.notes) notes.push(raw.notes.trim());

  return {
    readable: raw.readable === true,
    date,
    supplier: text(raw.supplier, MAX_SUPPLIER),
    supplierTin: text(raw.supplierTin, 40),
    invoiceNumber: text(raw.invoiceNumber, 40),
    amount,
    vat: raw.vatIncluded === true,
    vatRate: raw.vatIncluded ? (vatRate ? Math.round(vatRate * 100) / 100 : null) : null,
    method,
    category,
    material: category === "Material" ? text(raw.material, MAX_MATERIAL) : null,
    qty: category === "Material" ? positive(raw.qty, 1_000_000) : null,
    description: text(raw.description, Math.min(MAX_DESCRIPTION, 120)),
    notes: notes.map((n) => n.slice(0, 300)).slice(0, 4),
  };
}

/** The names already used in the app, so a reading reuses their spelling (most recent first). */
async function knownNames(): Promise<{ suppliers: string[]; materials: string[] }> {
  const rows = await getBuyersClient().fetch<{ supplier?: string; material?: string }[]>(
    `*[_type == "siteExpense" && string::startsWith(_id, $prefix) && coalesce(kind, "expense") == "expense"] | order(createdAt desc)[0...400]{ supplier, material }`,
    { prefix: EXPENSE_PREFIX }
  );
  const unique = (values: (string | undefined)[], cap: number) => {
    const seen = new Map<string, string>();
    for (const v of values) {
      const s = (v ?? "").trim();
      if (s && !seen.has(s.toLowerCase())) seen.set(s.toLowerCase(), s);
    }
    return [...seen.values()].slice(0, cap);
  };
  return { suppliers: unique(rows.map((r) => r.supplier), 80), materials: unique(rows.map((r) => r.material), 120) };
}

/** Reads one stored receipt (a photo or a PDF). */
export async function readReceipt(receiptId: unknown): Promise<ReceiptReading> {
  const { url, type } = receiptFile(receiptId);
  const pdf = type === "application/pdf";

  let response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (response.status === 404) {
    // Just uploaded: give the image store a moment.
    await new Promise((r) => setTimeout(r, 1500));
    response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  }
  if (response.status === 404) throw new TodoError(404, "That receipt isn't there any more. Add it again.");
  if (!response.ok) throw new TodoError(502, "The receipt couldn't be opened just now. Try again.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new TodoError(413, "That receipt is too big to read. Take a photo of it instead.");
  const data = bytes.toString("base64");

  const known = await knownNames().catch(() => ({ suppliers: [], materials: [] }));
  const content: ClaudeContent = [
    pdf
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : { type: "image", source: { type: "base64", media_type: type, data } },
    {
      type: "text",
      text: [
        `Today is ${todayISO()}.`,
        `Known suppliers: ${known.suppliers.join("; ") || "none yet"}.`,
        `Known materials: ${known.materials.join("; ") || "none yet"}.`,
        "Read this receipt for the expense form.",
      ].join("\n"),
    },
  ];

  const result = await writeWithClaude<RawReading>({
    system: SYSTEM,
    content,
    schema: SCHEMA,
    effort: "medium",
    maxTokens: 8000,
    purpose: "receipt reading",
  });
  if (!result.ok) {
    if (/not connected/i.test(result.error)) throw new TodoError(503, "Reading receipts isn't switched on (no AI key on the website).");
    console.error("[receipt reading]", result.error);
    throw new TodoError(502, "The receipt couldn't be read just now. Try again, or fill in the form yourself.");
  }
  return clean(result.value);
}
