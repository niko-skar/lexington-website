/**
 * Brings the expense log over from the Claude page "Site Expense Log" into the site app
 * (/todo/expenses): every entry exactly as it was, with its receipt. It reads the page's backup
 * folder on Google Drive (entries/expenses/*.json + receipts/... [assetId].jpg|pdf).
 *
 * Safe to run again: entries keep their old ids, so nothing is added twice, and an identical
 * receipt is stored only once. Old purchases do NOT add store stock (the store starts from a count).
 *
 *   npx tsx --env-file=.env.local scripts/import-expenses.ts "<backup folder>"          test copy ("expense-dev-" ids)
 *   npx tsx --env-file=.env.local scripts/import-expenses.ts "<backup folder>" --live   the real list
 */
import fs from "node:fs";
import path from "node:path";

import { createClient } from "@sanity/client";

type Old = {
  date: string;
  amount: number;
  kind?: "expense" | "inflow";
  forWho?: string;
  supplier?: string;
  description?: string;
  tag?: string | null;
  method?: string | null;
  category?: string | null;
  material?: string | null;
  qty?: number | null;
  receipt?: string | null;
  receiptType?: string | null;
  createdAt?: number;
  updatedAt?: number;
};

const [folder, flag] = process.argv.slice(2);
if (!folder || !fs.existsSync(path.join(folder, "entries", "expenses"))) {
  console.error('Usage: import-expenses.ts "<backup folder with entries/expenses and receipts>" [--live]');
  process.exit(2);
}
const live = flag === "--live";
const prefix = live ? "expense-live-" : "expense-dev-";

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const dataset = process.env.NEXT_PUBLIC_SANITY_BUYERS_DATASET;
const token = process.env.SANITY_BUYERS_API_TOKEN;
if (!projectId || !dataset || !token) {
  console.error("Missing NEXT_PUBLIC_SANITY_PROJECT_ID / NEXT_PUBLIC_SANITY_BUYERS_DATASET / SANITY_BUYERS_API_TOKEN");
  process.exit(2);
}
const client = createClient({ projectId, dataset, token, apiVersion: "2024-06-01", useCdn: false });

const entryDir = path.join(folder, "entries", "expenses");
const receiptDir = path.join(folder, "receipts");
const receiptFiles = fs.existsSync(receiptDir) ? fs.readdirSync(receiptDir) : [];
const iso = (ms: number | undefined) => new Date(ms || Date.now()).toISOString();

async function main() {
  const files = fs.readdirSync(entryDir).filter((f) => f.endsWith(".json"));
  const old = files.map((f) => ({ id: f.slice(0, -5), doc: JSON.parse(fs.readFileSync(path.join(entryDir, f), "utf8")) as Old }));
  for (const { id } of old) if (!/^[a-z0-9]{12,24}$/.test(id)) throw new Error(`Unexpected entry id ${id}`);

  const existing = new Set(
    await client.fetch<string[]>(`*[_type == "siteExpense" && _id in $ids]._id`, { ids: old.map((o) => prefix + o.id) })
  );
  console.log(`${old.length} entries in the backup; ${existing.size} already brought over (${prefix}*).`);

  let added = 0;
  let receipts = 0;
  let tx = client.transaction();
  let inTx = 0;
  for (const { id, doc } of old) {
    if (existing.has(prefix + id)) continue;
    let receipt: Record<string, unknown> | undefined;
    if (doc.receipt) {
      const name = receiptFiles.find((f) => f.includes(`[${doc.receipt}]`));
      if (!name) throw new Error(`Receipt ${doc.receipt} of entry ${id} is not in ${receiptDir}`);
      const pdf = name.toLowerCase().endsWith(".pdf");
      const asset = await client.assets.upload(pdf ? "file" : "image", fs.readFileSync(path.join(receiptDir, name)), {
        filename: `receipt-${doc.date}-${doc.receipt.slice(0, 6)}.${pdf ? "pdf" : "jpg"}`,
        contentType: pdf ? "application/pdf" : "image/jpeg",
      });
      receipt = { _type: pdf ? "file" : "image", asset: { _type: "reference", _ref: asset._id } };
      receipts++;
    }
    tx = tx.createIfNotExists({
      _id: prefix + id,
      _type: "siteExpense",
      date: doc.date,
      kind: doc.kind === "inflow" ? "inflow" : "expense",
      forWho: doc.forWho || "Site",
      amount: doc.amount,
      supplier: doc.supplier ?? "",
      description: doc.description ?? "",
      floor: doc.tag ?? null,
      method: doc.method ?? null,
      category: doc.category ?? null,
      material: doc.material ?? null,
      qty: doc.qty ?? null,
      itemId: null,
      toStore: false,
      ...(receipt ? { receipt } : {}),
      createdAt: iso(doc.createdAt),
      createdBy: "Niko",
      source: "claude-page",
      sourceUpdatedAt: iso(doc.updatedAt),
    });
    added++;
    if (++inTx === 40) {
      await tx.commit();
      tx = client.transaction();
      inTx = 0;
    }
  }
  if (inTx) await tx.commit();
  console.log(`Added ${added} entries (${receipts} receipts uploaded).`);

  // Check: the same number of entries and the same totals as the backup.
  const check = await client.fetch<{ n: number; out: number; in: number; receipts: number }>(
    `{
      "n": count(*[_type == "siteExpense" && _id in $ids]),
      "out": math::sum(*[_type == "siteExpense" && _id in $ids && kind == "expense"].amount),
      "in": math::sum(*[_type == "siteExpense" && _id in $ids && kind == "inflow"].amount),
      "receipts": count(*[_type == "siteExpense" && _id in $ids && defined(receipt.asset)])
    }`,
    { ids: old.map((o) => prefix + o.id) }
  );
  const want = {
    n: old.length,
    out: old.filter((o) => o.doc.kind !== "inflow").reduce((s, o) => s + o.doc.amount, 0),
    in: old.filter((o) => o.doc.kind === "inflow").reduce((s, o) => s + o.doc.amount, 0),
    receipts: old.filter((o) => o.doc.receipt).length,
  };
  const same = (a: number, b: number) => Math.abs((a || 0) - b) < 0.005;
  const ok = check.n === want.n && same(check.out, want.out) && same(check.in, want.in) && check.receipts === want.receipts;
  console.log(`In the app: ${check.n} entries, spent ${check.out}, money in ${check.in}, ${check.receipts} with a receipt.`);
  console.log(`Backup:     ${want.n} entries, spent ${want.out}, money in ${want.in}, ${want.receipts} with a receipt.`);
  console.log(ok ? "MATCH" : "MISMATCH");
  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
