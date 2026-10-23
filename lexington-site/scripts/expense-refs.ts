/**
 * Gives every expense that has no reference yet its number, oldest first: EXP-0001, EXP-0002...
 * for expenses and IN-0001... for money in, carrying on after the highest number already given,
 * and sets the counter new entries take their numbers from. Safe to run again (numbered entries
 * are left alone).
 *
 *   npx tsx --env-file=.env.local scripts/expense-refs.ts          test entries ("expense-dev-")
 *   npx tsx --env-file=.env.local scripts/expense-refs.ts --live   the real list
 */
import { createClient } from "@sanity/client";

const live = process.argv.includes("--live");
const tag = live ? "live" : "dev";
const prefix = `expense-${tag}-`;
const counterId = `expensecounter-${tag}`;

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const dataset = process.env.NEXT_PUBLIC_SANITY_BUYERS_DATASET;
const token = process.env.SANITY_BUYERS_API_TOKEN;
if (!projectId || !dataset || !token) {
  console.error("Missing NEXT_PUBLIC_SANITY_PROJECT_ID / NEXT_PUBLIC_SANITY_BUYERS_DATASET / SANITY_BUYERS_API_TOKEN");
  process.exit(2);
}
const client = createClient({ projectId, dataset, token, apiVersion: "2024-06-01", useCdn: false });

type Row = { _id: string; kind: "expense" | "inflow"; ref?: string; date: string; createdAt?: string };
const numberOf = (ref?: string) => Number(/^(?:EXP|IN)-(\d+)$/.exec(ref ?? "")?.[1] ?? 0);
const refOf = (kind: "expense" | "inflow", n: number) => `${kind === "inflow" ? "IN" : "EXP"}-${String(n).padStart(4, "0")}`;

async function main() {
  const rows = await client.fetch<Row[]>(
    `*[_type == "siteExpense" && string::startsWith(_id, $prefix)] | order(date asc, createdAt asc){ _id, "kind": coalesce(kind, "expense"), ref, date, createdAt }`,
    { prefix }
  );
  const counter = await client.fetch<{ _rev: string; expense?: number; inflow?: number } | null>(`*[_id == $id][0]{ _rev, expense, inflow }`, { id: counterId });
  const next: Record<"expense" | "inflow", number> = { expense: 0, inflow: 0 };
  for (const kind of ["expense", "inflow"] as const) {
    next[kind] = Math.max(counter?.[kind] ?? 0, ...rows.filter((r) => r.kind === kind).map((r) => numberOf(r.ref)), 0);
  }

  const todo = rows.filter((r) => !r.ref);
  let tx = client.transaction();
  let inTx = 0;
  for (const r of todo) {
    next[r.kind] += 1;
    tx = tx.patch(r._id, (p) => p.set({ ref: refOf(r.kind, next[r.kind]) }));
    if (++inTx === 50) {
      await tx.commit();
      tx = client.transaction();
      inTx = 0;
    }
  }
  if (inTx) await tx.commit();

  // The counter last, so a new entry saved meanwhile never takes a number given out here.
  if (counter) await client.patch(counterId).set(next).commit();
  else await client.createIfNotExists({ _id: counterId, _type: "siteExpenseCounter", ...next });

  const check = await client.fetch<{ n: number; numbered: number; refs: string[] }>(
    `{ "n": count(*[_type == "siteExpense" && string::startsWith(_id, $prefix)]), "numbered": count(*[_type == "siteExpense" && string::startsWith(_id, $prefix) && defined(ref)]), "refs": *[_type == "siteExpense" && string::startsWith(_id, $prefix)].ref }`,
    { prefix }
  );
  const unique = new Set(check.refs.filter(Boolean)).size;
  console.log(`${todo.length} entries numbered now; ${check.numbered}/${check.n} have a reference; ${unique} different references; counter EXP ${next.expense}, IN ${next.inflow}.`);
  if (check.numbered !== check.n || unique !== check.numbered) {
    console.error("PROBLEM: some entries have no reference or share one.");
    process.exit(1);
  }
  console.log("OK");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
