import "server-only";

import { savePaydayEntry } from "@/lib/expenses/server";
import { syncExpense } from "@/lib/expenses/sheet";
import { classNamed, TRADE_CLASS } from "@/lib/quickbooks/books";
import { cachedBookLists } from "@/lib/quickbooks/booksCache";
import { feedExpense } from "@/lib/quickbooks/feed";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { EXPENSE_PREFIX, ROLLCALL_PREFIX } from "@/lib/site/ids";
import { groupFigures, paydayGroups, WAGES_FROM_WEEK } from "./payday";

// Wages paid in Payday go into the expenses by themselves, and from there to QuickBooks and the Google Sheet like
// any site expense (Niko, 30 Oct 2026: "as I make payments the transactions should get processed and put into
// quickbooks at the same time"). One entry per pay week and way of paying ("Wages, week from 2 Nov (Payday)",
// to Site workers), one line per worker paid, each line on the QuickBooks class of the worker's trade (Labour:
// Masons & Labourers, Carpenters, Steel Benders); the steel machines are their own entry (Equipment Rental:
// Steel Machine Rentals). The entry follows Payday: a payment changed or taken back there changes it here.
// Weeks before the roll call moved into the app (paid on the Claude page) were typed in the expenses by hand,
// so they never come in: that would count them twice.

/** Payments made one after another: QuickBooks and the sheet hear once they've stopped for this long. */
const SETTLE_MS = 30_000;
const KEYS = ["momo", "cash", "bank", "mach"];

const entryId = (week: string, key: string) => `${EXPENSE_PREFIX}wg${week.replace(/-/g, "")}${key}`;
const shortDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** A pay week's payments, saved in Payday a moment ago, into the expenses. */
export async function syncWages(week: string): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || week < WAGES_FROM_WEEK) return;
  try {
    const client = getBuyersClient();
    const [record, workerRows, books] = await Promise.all([
      client.fetch<string | null>(`*[_id == $id][0].json`, { id: `${ROLLCALL_PREFIX}payments--${week}` }),
      client.fetch<Array<{ key: string; json: string }>>(`*[_type == "rollcallDoc" && string::startsWith(_id, $prefix) && col == "workers"]{ key, json }`, { prefix: ROLLCALL_PREFIX }),
      cachedBookLists().catch(() => ({ classes: [], locations: [], fetchedAt: null })),
    ]);
    const paid = record ? ((JSON.parse(record) as { paid?: Record<string, unknown> }).paid ?? {}) : {};
    const workers = new Map(workerRows.map((r) => [r.key, JSON.parse(r.json) as { name?: string; trade?: string }]));
    const groups = paydayGroups(paid, workers);

    const changed: Array<{ id: string; hash: string }> = [];
    for (const key of KEYS) {
      const g = groups.find((x) => x.key === key);
      const id = entryId(week, key);
      const figures = g ? groupFigures(g) : null;
      const machines = g?.kind === "machines";
      const hash = await savePaydayEntry(
        id,
        g && figures
          ? {
              date: figures.date,
              amount: figures.amount,
              method: g.method,
              supplier: machines ? g.lines[0].name : "Site workers",
              description: machines
                ? `Steel machines, week from ${shortDay(week)} (Payday)`
                : `Wages, week from ${shortDay(week)} (Payday): ${g.lines.length} ${g.lines.length === 1 ? "worker" : "workers"}`,
              costClass: machines ? classNamed(TRADE_CLASS.machines, books.classes) : null,
              payday: { week, kind: g.kind, lines: g.lines },
            }
          : null
      );
      if (hash && hash !== "removed") changed.push({ id, hash });
    }

    // Once the payments have stopped for a moment, the changed entries go to the sheet and QuickBooks (a later
    // payment's own run sends the week if it changed again meanwhile; the crons catch anything missed).
    if (!changed.length) return;
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    for (const { id, hash } of changed) {
      const now = await client.fetch<string | null>(`*[_id == $id][0].payday.hash`, { id });
      if (now !== hash) continue;
      await syncExpense(id).catch((e) => console.error("[wages] sheet:", e instanceof Error ? e.message : e));
      await feedExpense(id);
    }
  } catch (error) {
    console.error("[wages]", week, error instanceof Error ? error.message : error);
  }
}
