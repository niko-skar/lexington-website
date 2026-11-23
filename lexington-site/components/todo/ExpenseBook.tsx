"use client";

import { memo, useMemo, useState } from "react";

import { CATEGORIES, FLOORS, FOR_WHO, isInflow, METHODS, money, receiptFileName, todayISO, vatParts, type Expense } from "@/lib/expenses/shared";
import { fmtQty } from "@/lib/store/shared";
import { niceDate } from "./ExpenseForm";
import site from "./Site.module.css";
import styles from "./Todo.module.css";

// The totals and the list under the form, as on the old expense page: period / who for / floor
// filters, spend by floor, how it was paid, materials bought, then every entry by day. Plus the
// VAT to reclaim and to pay. It only redraws when the entries or the search change, never while
// typing in the form.

function monthName(k: string) {
  const [y, m] = k.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

/* ---------- the search (Niko, 23 Nov 2026: "i need to be able to search through them so i can find things i've already paid quickly") ----------
   Every month at once. Each word typed must be somewhere in the entry: who was paid, what for, the materials, the ref,
   the amount (2400, 2,400 or 2400.00), the day (15 November 2026), the floor, how it was paid, a worker's name on a
   wage entry. */

/** Small letters, no accents: what the search compares. */
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
/** The words typed, less "GHS" / "₵" (the amounts are all cedis). */
export const searchWords = (q: string) =>
  fold(q)
    .split(/\s+/)
    .filter((w) => w && !/^(ghs|gh₵|ghc|₵|cedis?)$/.test(w));
const GROUPED = new Intl.NumberFormat("en-GB");
const GROUPED_2 = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const LONG_DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });
/** An amount as it may be typed. */
const amountForms = (n: number) => [String(n), n.toFixed(2), GROUPED.format(n), GROUPED_2.format(n)];
const isNumberWord = (w: string) => /^[\d.,]+$/.test(w);

function searchText(x: Expense) {
  const [y, m, d] = x.date.split("-").map(Number);
  return fold(
    [
      x.ref,
      x.supplier,
      x.description,
      x.material,
      ...(x.moreLines ?? []).map((l) => l.material),
      x.category,
      x.floor,
      x.forWho,
      x.method,
      isInflow(x) ? "money in" : "",
      x.vat ? "vat" : "",
      x.date,
      y && m && d ? LONG_DAY.format(new Date(y, m - 1, d)) : "",
      ...amountForms(x.amount),
      ...(x.payday?.lines ?? []).flatMap((l) => [l.name, ...amountForms(l.amount)]),
    ]
      .filter(Boolean)
      .join("\n")
  );
}

/** A wage entry's payments to the worker searched for: shown on the entry, since the entry itself only says "wages". */
const paidTo = (x: Expense, words: string[]) =>
  (x.payday?.lines ?? []).filter((l) => words.some((w) => !isNumberWord(w) && fold(l.name).includes(w)));

/** Entries found that show at once (more on a tap): typing stays quick on a phone. */
const FOUND_AT_ONCE = 100;

/** A receipt's address that downloads under its traceable name. */
export const receiptDownload = (x: Pick<Expense, "receiptUrl" | "receiptType" | "date" | "ref" | "supplier" | "kind" | "amount" | "vat">) =>
  x.receiptUrl ? `${x.receiptUrl}?dl=${encodeURIComponent(receiptFileName(x, x.receiptType))}` : "";

function materialStats(list: Expense[]) {
  const stats = new Map<string, { key: string; name: string; qty: number; amount: number; count: number; last: string; lastAt: string }>();
  for (const x of list) {
    if (isInflow(x) || !x.material) continue;
    const k = x.material.toLowerCase();
    const row = stats.get(k) ?? { key: k, name: x.material, qty: 0, amount: 0, count: 0, last: "", lastAt: "" };
    row.qty += Number(x.qty) || 0;
    row.amount += x.amount;
    row.count++;
    if (x.date > row.last) row.last = x.date;
    if ((x.createdAt ?? "") > row.lastAt) {
      row.lastAt = x.createdAt ?? "";
      row.name = x.material;
    }
    stats.set(k, row);
  }
  return [...stats.values()];
}

export const ExpenseBook = memo(function ExpenseBook({
  expenses,
  editingId,
  onEdit,
  onOpenReceipt,
  query = "",
}: {
  expenses: Expense[];
  editingId: string | null;
  onEdit: (x: Expense) => void;
  onOpenReceipt: (x: Expense) => void;
  /** What's typed in the search box over the page: then only what it finds, from every month, instead of the totals. */
  query?: string;
}) {
  // Other costs on the same receipt as an entry (transport with the wawa boards): shown with each other.
  const withOthers = useMemo(() => {
    const byMain = new Map<string, Expense[]>();
    for (const e of expenses) if (e.withId) byMain.set(e.withId, [...(byMain.get(e.withId) ?? []), e]);
    return byMain;
  }, [expenses]);
  const refOf = useMemo(() => new Map(expenses.map((e) => [e.id, e.ref ?? ""])), [expenses]);
  const [period, setPeriod] = useState("this");
  const [forFilter, setForFilter] = useState("all");
  const [floorFilter, setFloorFilter] = useState("all");
  const [matFilter, setMatFilter] = useState<string | null>(null);

  const thisMonth = todayISO().slice(0, 7);
  const lastMonth = (() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return todayISO(d).slice(0, 7);
  })();
  const months = useMemo(() => [...new Set(expenses.map((x) => x.date.slice(0, 7)))].sort().reverse(), [expenses]);
  const periodName = period === "this" ? "This month" : period === "last" ? "Last month" : period === "all" ? "All time" : monthName(period);

  const words = useMemo(() => searchWords(query), [query]);
  const searching = words.length > 0;
  // Each entry's words, made once when a search starts (and again only when the entries change).
  const index = useMemo(() => (searching ? expenses.map((x) => ({ x, text: searchText(x) })) : []), [expenses, searching]);
  const shown = useMemo(
    () =>
      searching
        ? index.filter(({ text }) => words.every((w) => text.includes(w))).map(({ x }) => x)
        : expenses.filter((x) => {
            const m = x.date.slice(0, 7);
            if (period === "this" && m !== thisMonth) return false;
            if (period === "last" && m !== lastMonth) return false;
            if (/^\d{4}-\d{2}$/.test(period) && m !== period) return false;
            if (forFilter !== "all" && x.forWho !== forFilter) return false;
            if (floorFilter !== "all" && x.floor !== floorFilter) return false;
            if (matFilter && (x.material ?? "").toLowerCase() !== matFilter) return false;
            return true;
          }),
    [searching, index, words, expenses, period, forFilter, floorFilter, matFilter, thisMonth, lastMonth]
  );
  // A search shows its first hundred; "Show more" adds a hundred at a time (back to a hundred when the words change).
  const [more, setMore] = useState({ query: "", extra: 0 });
  const extra = more.query === query ? more.extra : 0;
  const listed = useMemo(() => (searching ? shown.slice(0, FOUND_AT_ONCE + extra) : shown), [searching, shown, extra]);

  const totals = useMemo(() => {
    const outs = shown.filter((x) => !isInflow(x));
    const ins = shown.filter(isInflow);
    const sum = (l: Expense[]) => l.reduce((s, x) => s + x.amount, 0);
    const placeSums = new Map<string, number>();
    for (const x of outs) {
      const k = x.floor || (x.forWho !== "Site" ? x.forWho : "Site, no floor");
      placeSums.set(k, (placeSums.get(k) ?? 0) + x.amount);
    }
    const order = [...FLOORS, ...FOR_WHO.slice(1), "Site, no floor"] as string[];
    const vatOf = (l: Expense[]) => l.reduce((s, x) => s + (x.vat ? vatParts(x.amount, x.vatRate).vat : 0), 0);
    return {
      outs,
      total: sum(outs),
      inTotal: sum(ins),
      byPlace: [...placeSums.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])),
      byMethod: METHODS.map((m) => [m, outs.reduce((s, x) => (x.method === m ? s + x.amount : s), 0)] as const).filter(([, v]) => v > 0),
      byCategory: CATEGORIES.map((c) => [c, outs.reduce((s, x) => (x.category === c ? s + x.amount : s), 0)] as const).filter(([, v]) => v > 0),
      vatIn: vatOf(outs),
      vatOut: vatOf(ins),
      vatCount: shown.filter((x) => x.vat).length,
      materials: materialStats(shown).sort((a, b) => b.amount - a.amount),
    };
  }, [shown]);
  const maxPlace = Math.max(0, ...totals.byPlace.map(([, v]) => v));

  const days = useMemo(() => {
    const groups: { date: string; list: Expense[] }[] = [];
    for (const x of listed) {
      const last = groups[groups.length - 1];
      if (last && last.date === x.date) last.list.push(x);
      else groups.push({ date: x.date, list: [x] });
    }
    return groups;
  }, [listed]);

  const exportCsv = async () => {
    const cell = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\r\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [
      [
        "Ref",
        "Date",
        "Type",
        "For",
        "Amount (GHS)",
        "VAT",
        "VAT rate %",
        "VAT (GHS)",
        "Before VAT (GHS)",
        "Supplier / from",
        "Category",
        "Material",
        "Quantity",
        "Into the store",
        "Description",
        "Floor / area",
        "Paid by",
        "Receipt",
      ],
      ...shown.map((x) => {
        const v = x.vat ? vatParts(x.amount, x.vatRate) : null;
        return [
          x.ref ?? "",
          x.date,
          isInflow(x) ? "Money in" : "Expense",
          x.forWho,
          x.amount.toFixed(2),
          x.vat ? "yes" : "",
          x.vat ? (x.vatRate ?? "") : "",
          v ? v.vat.toFixed(2) : "",
          v ? v.net.toFixed(2) : "",
          x.supplier,
          x.category ?? "",
          x.material ?? "",
          x.qty ?? "",
          x.toStore ? "yes" : "",
          x.description,
          x.floor ?? "",
          x.method ?? "",
          x.driveUrl || receiptDownload(x),
        ];
      }),
    ];
    const csv = "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
    const name = `lexington-expenses-${searching ? "search" : period === "this" ? thisMonth : period === "last" ? lastMonth : period}.csv`;
    const file = new File([csv], name, { type: "text/csv" });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return;
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <>
      {searching ? (
        shown.length > 0 && (
          <section className={site.card} aria-label="Found">
            <div className={site.formHead}>
              <h2 className={site.formTitle}>{shown.length} found</h2>
              <button type="button" className={site.exportButton} onClick={() => void exportCsv()}>
                Export CSV
              </button>
            </div>
            <p className={site.foundLine}>
              {["Every month, newest first", totals.outs.length ? `paid ${money(totals.total)}` : "", totals.inTotal ? `in ${money(totals.inTotal)}` : ""]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </section>
        )
      ) : (
        <section className={site.card} aria-label="Totals">
          <div className={site.formHead}>
            <h2 className={site.formTitle}>Totals · {periodName}</h2>
            <button type="button" className={site.exportButton} onClick={() => void exportCsv()} disabled={shown.length === 0}>
              Export CSV
            </button>
          </div>
          <div className={site.filters}>
            <label>
              <span className={styles.label}>Period</span>
              <select className={styles.input} value={period} onChange={(e) => setPeriod(e.target.value)}>
                <option value="this">This month</option>
                <option value="last">Last month</option>
                <option value="all">All time</option>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {monthName(m)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={styles.label}>For</span>
              <select className={styles.input} value={forFilter} onChange={(e) => setForFilter(e.target.value)}>
                <option value="all">Everything</option>
                {FOR_WHO.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
            <label>
              <span className={styles.label}>Floor / area</span>
              <select className={styles.input} value={floorFilter} onChange={(e) => setFloorFilter(e.target.value)}>
                <option value="all">All floors</option>
                {FLOORS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
          </div>

          <div className={site.totalRow}>
            <strong>
              {totals.outs.length} expense{totals.outs.length === 1 ? "" : "s"}
            </strong>
            <strong className={site.num}>{money(totals.total)}</strong>
          </div>
          {totals.outs.length === 0 && <p className={styles.sheetNote}>No expenses recorded for this period yet.</p>}
          {totals.byPlace.map(([place, value]) => (
            <div key={place} className={site.bar}>
              <span>{place}</span>
              <span className={site.track}>
                <span className={site.fill} style={{ width: `${maxPlace ? ((value / maxPlace) * 100).toFixed(1) : 0}%` }} />
              </span>
              <span className={site.num}>{money(value)}</span>
            </div>
          ))}
          <div className={site.pills}>
            {totals.inTotal > 0 && (
              <>
                <span className={site.pillIn}>
                  Money in <b>{money(totals.inTotal)}</b>
                </span>
                <span className={site.pill}>
                  Balance <b>{(totals.inTotal - totals.total < 0 ? "−" : "") + money(Math.abs(totals.inTotal - totals.total))}</b>
                </span>
              </>
            )}
            {totals.byMethod.map(([m, v]) => (
              <span key={m} className={site.pill}>
                Paid {m} <b>{money(v)}</b>
              </span>
            ))}
          </div>
          {totals.byCategory.length > 0 && (
            <div className={site.pills}>
              {totals.byCategory.map(([c, v]) => (
                <span key={c} className={site.pill}>
                  {c} <b>{money(v)}</b>
                </span>
              ))}
            </div>
          )}
          {totals.vatCount > 0 && (
            <div className={site.vatBox}>
              <div>
                <span>VAT paid on purchases (to reclaim)</span>
                <span className={site.num}>{money(totals.vatIn)}</span>
              </div>
              <div>
                <span>VAT on money in (to pay)</span>
                <span className={site.num}>{money(totals.vatOut)}</span>
              </div>
              <div>
                <strong>{totals.vatOut - totals.vatIn >= 0 ? "VAT to pay" : "VAT to reclaim"}</strong>
                <strong className={site.num}>{money(Math.abs(totals.vatOut - totals.vatIn))}</strong>
              </div>
            </div>
          )}
          {matFilter && (
            <div className={site.matFilter}>
              <span>Showing only: {totals.materials[0]?.name ?? matFilter}</span>
              <button type="button" className={styles.linkButton} onClick={() => setMatFilter(null)}>
                Show all
              </button>
            </div>
          )}
          {totals.materials.length > 0 && (
            <div>
              <h3 className={styles.label}>Materials bought</h3>
              {totals.materials.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  className={site.matRow}
                  onClick={() => {
                    setMatFilter(r.key);
                    document.getElementById("exp-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >
                  <span className={site.matName}>
                    {r.name}
                    <small>
                      Last bought {niceDate(r.last)} · {r.count} purchase{r.count === 1 ? "" : "s"}
                    </small>
                  </span>
                  <span className={site.num}>× {fmtQty(r.qty)}</span>
                  <span className={site.num}>{money(r.amount)}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      <section id="exp-list" className={site.ledger} aria-label="Expenses">
        {days.length === 0 ? (
          <p className={styles.empty}>
            {searching
              ? `Nothing found for “${query.trim()}”. Try who you paid, what it was for, an amount, or a ref like EXP-0042.`
              : expenses.length
              ? "Nothing matches these filters."
              : "Nothing logged yet. Enter an amount, pick a floor and how you paid, then tap Save expense. Switch to Money in to record money received."}
          </p>
        ) : (
          days.map((day) => {
            const dayOut = day.list.filter((x) => !isInflow(x)).reduce((s, x) => s + x.amount, 0);
            const dayIn = day.list.filter(isInflow).reduce((s, x) => s + x.amount, 0);
            return (
              <div key={day.date} className={site.day}>
                <div className={site.dayHead}>
                  <span>{niceDate(day.date)}</span>
                  <span className={site.num}>{[dayOut ? money(dayOut) : "", dayIn ? "+" + money(dayIn) : ""].filter(Boolean).join(" · ")}</span>
                </div>
                {day.list.map((x) => {
                  const xIn = isInflow(x);
                  return (
                    <div key={x.id} className={`${site.entryCard} ${xIn ? site.entryIn : ""} ${editingId === x.id ? site.entryEditing : ""}`}>
                      <button type="button" className={site.entryMain} onClick={() => onEdit(x)} aria-label={`Edit ${x.supplier || (xIn ? "money in" : "expense")} ${money(x.amount)}`}>
                        <span className={site.sup}>{x.supplier || (xIn ? "Money in" : "No supplier")}</span>
                        <span className={site.amt}>
                          {xIn ? "+" : ""}
                          {money(x.amount)}
                        </span>
                        {x.material && (
                          <span className={site.item}>
                            <span className={site.num}>{fmtQty(x.qty ?? 0)} × </span>
                            {x.material}
                            {x.toStore ? <span className={site.storeTag}>Store</span> : null}
                          </span>
                        )}
                        {(x.moreLines ?? []).map((l, i) => (
                          <span key={i} className={site.item}>
                            <span className={site.num}>{fmtQty(l.qty)} × </span>
                            {l.material}
                            {l.toStore ? <span className={site.storeTag}>Store</span> : null}
                          </span>
                        ))}
                        {x.description && <span className={site.desc}>{x.description}</span>}
                        {searching &&
                          paidTo(x, words).map((l, i) => (
                            <span key={`${l.id}-${i}`} className={site.item}>
                              Paid {l.name} <span className={site.num}>{money(l.amount)}</span>
                            </span>
                          ))}
                        {(withOthers.get(x.id) ?? []).length > 0 && (
                          <span className={site.desc}>
                            Same receipt: {(withOthers.get(x.id) ?? []).map((o) => `${o.description} ${money(o.amount)}${o.ref ? ` (${o.ref})` : ""}`).join(", ")}
                          </span>
                        )}
                        {x.withId && <span className={site.desc}>Same receipt as {refOf.get(x.withId) || "another entry"}</span>}
                      </button>
                      <span className={site.tags}>
                        {x.ref && <span className={site.ref}>{x.ref}</span>}
                        {x.forWho !== "Site" && <span className={site.tag}>{x.forWho}</span>}
                        {xIn ? <span className={site.tagIn}>Money in</span> : x.floor ? <span className={site.tag}>{x.floor}</span> : null}
                        {x.category && x.category !== "Material" && <span className={site.tagMuted}>{x.category}</span>}
                        <span className={site.tagMuted}>{x.method || "—"}</span>
                        {x.bank && <span className={site.tagMuted}>{x.bank.matched ? "Bank text ✓" : "From bank text"}</span>}
                        {x.vat && <span className={site.tagVat}>VAT {x.vatRate ?? ""}%</span>}
                        {x.receiptUrl && (
                          <button type="button" className={site.clip} onClick={() => onOpenReceipt(x)}>
                            📎 Receipt
                          </button>
                        )}
                        {(x.moreReceipts ?? []).map((r, i) => (
                          <button key={r.id} type="button" className={site.clip} onClick={() => onOpenReceipt({ ...x, receiptUrl: r.url, receiptType: r.type })}>
                            📎 {i + 2}
                          </button>
                        ))}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
        {searching && shown.length > listed.length && (
          <button type="button" className={styles.linkButton} onClick={() => setMore({ query, extra: extra + FOUND_AT_ONCE })}>
            Show more ({shown.length - listed.length} left)
          </button>
        )}
      </section>
    </>
  );
});
