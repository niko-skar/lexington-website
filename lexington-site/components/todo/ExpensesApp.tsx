"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CATEGORIES,
  FLOORS,
  FOR_WHO,
  isInflow,
  MAX_DESCRIPTION,
  MAX_MATERIAL,
  MAX_SUPPLIER,
  METHODS,
  money,
  todayISO,
  type Expense,
  type ForWho,
} from "@/lib/expenses/shared";
import { fmtQty, MAX_UNIT, qtyUnit, UNITS, type StoreItem } from "@/lib/store/shared";
import { photoAt, type TodoMe } from "@/lib/todo/shared";
import { AccessSheet } from "./AccessSheet";
import { errorText, send, startPolling } from "./api";
import { QtyPicker } from "./QtyPicker";
import { forgetReceipt, isPdf, uploadReceipt } from "./receipt";
import { appClass, SiteMenu, SiteNav } from "./SiteChrome";
import site from "./Site.module.css";
import styles from "./Todo.module.css";

// The expense log, as it was on the Claude page (same buttons in the same order, the same totals),
// now beside the to-do list and the store room. New: a Material for the Site goes "into the store
// room" (its stock goes up by the quantity bought) unless that's switched off.

type ToastData = { text: string; tone?: "error" };
type Receipt = { id: string; url: string; type: string };

const RECEIPT_CAMERA = "exp-receipt-camera";
const RECEIPT_FILE = "exp-receipt-file";

const key = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const pdfType = (type: string | null | undefined) => type === "application/pdf";

function niceDate(iso: string) {
  const today = todayISO();
  if (iso === today) return "Today";
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (iso === todayISO(y)) return "Yesterday";
  const [yy, mm, dd] = iso.split("-").map(Number);
  const d = new Date(yy, mm - 1, dd);
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: yy === new Date().getFullYear() ? undefined : "numeric",
  });
}
function monthName(k: string) {
  const [y, m] = k.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
}
const sortExpenses = (list: Expense[]) =>
  [...list].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt ?? "").localeCompare(a.createdAt ?? "")));

/* ---------- the receipt being added (uploads as soon as it's picked) ---------- */

type Slot = {
  preview: string | null;
  name: string;
  pdf: boolean;
  state: "uploading" | "ready" | "error";
  stored?: Receipt;
  error?: string;
};

function useReceiptSlot() {
  const [slot, setSlot] = useState<Slot | null>(null);
  const job = useRef<Promise<Receipt | null> | null>(null);
  const token = useRef(0);

  const start = useCallback((file: File) => {
    const mine = ++token.current;
    const pdf = isPdf(file);
    const preview = pdf ? null : URL.createObjectURL(file);
    setSlot((old) => {
      if (old?.preview) URL.revokeObjectURL(old.preview);
      if (old?.stored) forgetReceipt(old.stored.id);
      return {
        preview,
        name: file.name || (pdf ? "Receipt.pdf" : "Photo"),
        pdf,
        state: "uploading",
      };
    });
    job.current = uploadReceipt(file).then(
      (stored) => {
        if (token.current !== mine) {
          forgetReceipt(stored.id); // replaced or removed meanwhile
          return null;
        }
        setSlot((s) => (s ? { ...s, state: "ready", stored } : s));
        return stored;
      },
      (e) => {
        if (token.current === mine) setSlot((s) => (s ? { ...s, state: "error", error: errorText(e) } : s));
        return null;
      },
    );
  }, []);

  const clear = useCallback((keepStored = false) => {
    token.current++;
    job.current = null;
    setSlot((old) => {
      if (old?.preview) URL.revokeObjectURL(old.preview);
      if (old?.stored && !keepStored) forgetReceipt(old.stored.id);
      return null;
    });
  }, []);

  /** Waits for an upload still on its way; null when there's none or it failed. */
  const settled = useCallback(async () => (job.current ? job.current : null), []);
  return { slot, start, clear, settled };
}

/* ---------- the page ---------- */

export function ExpensesApp({
  me,
  initialExpenses,
  initialItems,
  startedOffline,
}: {
  me: TodoMe;
  initialExpenses: Expense[];
  initialItems: StoreItem[];
  startedOffline: boolean;
}) {
  const [expenses, setExpenses] = useState(initialExpenses);
  const [items, setItems] = useState(initialItems);
  const [offline, setOffline] = useState(startedOffline);
  const [signedOut, setSignedOut] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);

  // The form: always ready for a new expense, today, for the Site.
  const [kind, setKind] = useState<"expense" | "inflow">("expense");
  const [forWho, setForWho] = useState<ForWho>("Site");
  const [date, setDate] = useState(() => todayISO());
  const [dateTouched, setDateTouched] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [material, setMaterial] = useState("");
  const [qty, setQty] = useState(1);
  const [toStoreChoice, setToStoreChoice] = useState<boolean | null>(null);
  const [unit, setUnit] = useState("pcs");
  const [supplier, setSupplier] = useState("");
  const [description, setDescription] = useState("");
  const [floor, setFloor] = useState<string | null>(null);
  const [method, setMethod] = useState<string | null>(null);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [kept, setKept] = useState<Receipt | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [armed, setArmed] = useState(false);
  const receipt = useReceiptSlot();
  const clearReceipt = receipt.clear;

  // Totals and the list.
  const [period, setPeriod] = useState("this");
  const [forFilter, setForFilter] = useState("all");
  const [floorFilter, setFloorFilter] = useState("all");
  const [matFilter, setMatFilter] = useState<string | null>(null);

  const amountRef = useRef<HTMLInputElement>(null);
  const localAt = useRef(0);
  const inFlight = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showToast = useCallback((data: ToastData) => {
    clearTimeout(toastTimer.current);
    setToast(data);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const startedAt = Date.now();
    try {
      const [a, b] = await Promise.all([fetch("/api/expenses", { cache: "no-store" }), fetch("/api/store", { cache: "no-store" })]);
      if ([a.status, b.status].some((s) => s === 401 || s === 403)) {
        setSignedOut(true);
        return;
      }
      if (!a.ok || !b.ok) throw new Error("refresh failed");
      const [x, y] = (await Promise.all([a.json(), b.json()])) as [{ expenses: Expense[] }, { items: StoreItem[] }];
      if (startedAt >= localAt.current) {
        setExpenses(x.expenses);
        setItems(y.items);
      }
      setOffline(false);
    } catch {
      setOffline(true);
    } finally {
      inFlight.current = false;
    }
  }, []);

  // Only the office uses this page: a check every 30 seconds while it's in use is plenty.
  useEffect(() => startPolling(refresh, 30_000, 120_000), [refresh]);

  // Past midnight with the page still open: a new entry is for the new day.
  useEffect(() => {
    const timer = setInterval(() => {
      if (!dateTouched && !editing) setDate((d) => (d === todayISO() ? d : todayISO()));
    }, 60_000);
    return () => clearInterval(timer);
  }, [dateTouched, editing]);

  /* ---------- the form ---------- */

  const inflow = kind === "inflow";
  const isMaterial = !inflow && category === "Material";
  const match = useMemo(() => (material.trim() ? items.find((i) => key(i.name) === key(material)) : undefined), [items, material]);
  const toStore = isMaterial && (toStoreChoice ?? (forWho === "Site" && (match ? match.stocked : true)));
  const showFloors = !inflow && forWho === "Site";

  const resetForm = useCallback(() => {
    setEditing(null);
    setKind("expense");
    setForWho("Site");
    setDate(todayISO());
    setDateTouched(false);
    setDateOpen(false);
    setAmount("");
    setCategory(null);
    setMaterial("");
    setQty(1);
    setToStoreChoice(null);
    setUnit("pcs");
    setSupplier("");
    setDescription("");
    setFloor(null);
    setMethod(null);
    setKept(null);
    setFormError("");
    setArmed(false);
    clearReceipt();
  }, [clearReceipt]);

  const startEdit = (x: Expense) => {
    if (saving) return; // the save on its way would clear the form again when it lands
    receipt.clear();
    setEditing(x);
    setKind(x.kind);
    setForWho(x.forWho);
    setDate(x.date);
    setDateTouched(true);
    setDateOpen(false);
    setAmount((x.amount || 0).toFixed(2));
    setCategory(x.category);
    setMaterial(x.material ?? "");
    setQty(x.qty || 1);
    setToStoreChoice(x.category === "Material" ? x.toStore : null);
    setUnit("pcs");
    setSupplier(x.supplier);
    setDescription(x.description);
    setFloor(x.floor);
    setMethod(x.method);
    setKept(
      x.receiptId && x.receiptUrl
        ? {
            id: x.receiptId,
            url: x.receiptUrl,
            type: x.receiptType ?? "image/jpeg",
          }
        : null,
    );
    setFormError("");
    setArmed(false);
    document.getElementById("exp-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const parsedAmount = () => {
    const n = parseFloat(amount.replace(/[^0-9.,]/g, "").replace(/,/g, ""));
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const value = parsedAmount();
    if (!(value > 0)) {
      setFormError(inflow ? "Enter the amount received." : "Enter the amount paid.");
      amountRef.current?.focus();
      return;
    }
    if (showFloors && !floor) return setFormError("Pick the floor or area.");
    if (!inflow && !category) return setFormError("Pick Material, Service or Other.");
    if (isMaterial && !material.trim()) return setFormError("Write which material you bought.");
    if (!method) return setFormError(inflow ? "Pick how the money came in." : "Pick how it was paid.");
    setFormError("");
    setSaving(true);
    try {
      let receiptId = kept?.id ?? null;
      if (receipt.slot) {
        const stored = await receipt.settled();
        if (!stored) {
          setFormError("The receipt didn't upload. Try it again, or remove it to save without it.");
          return;
        }
        receiptId = stored.id;
      }
      const body = {
        date,
        kind,
        forWho,
        amount: value,
        supplier: supplier.trim(),
        description: description.trim(),
        floor: showFloors ? floor : null,
        method,
        category: inflow ? null : category,
        material: isMaterial ? material.trim() : null,
        qty: isMaterial ? qty : null,
        toStore,
        unit: unit.trim() || "pcs",
        receiptId,
      };
      const { expense } = editing
        ? await send<{ expense: Expense }>(`/api/expenses/${editing.id}`, "PATCH", body)
        : await send<{ expense: Expense }>("/api/expenses", "POST", body);
      localAt.current = Date.now();
      setExpenses((list) => sortExpenses([expense, ...list.filter((x) => x.id !== expense.id)]));
      receipt.clear(true);
      const stockNote = expense.toStore && expense.qty ? ` · ${fmtQty(expense.qty)} into the store` : "";
      showToast({
        text: editing ? "Changes saved" : `${inflow ? "Money in saved" : "Expense saved"} · ${money(expense.amount)}${stockNote}`,
      });
      resetForm();
      amountRef.current?.focus();
      if (expense.toStore || editing?.toStore) void refresh();
    } catch (err) {
      if ((err as { status?: number }).status === 401) setSignedOut(true);
      setFormError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    setSaving(true);
    try {
      await send(`/api/expenses/${editing.id}`, "DELETE");
      localAt.current = Date.now();
      setExpenses((list) => list.filter((x) => x.id !== editing.id));
      const hadStock = editing.toStore;
      resetForm();
      showToast({ text: "Deleted" });
      if (hadStock) void refresh();
    } catch (err) {
      setFormError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  /* ---------- suggestions ---------- */

  const suppliers = useMemo(() => {
    const seen = new Map<string, string>();
    [...expenses]
      .filter((x) => isInflow(x) === inflow)
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
      .forEach((x) => {
        const s = x.supplier.trim();
        if (s && !seen.has(s.toLowerCase())) seen.set(s.toLowerCase(), s);
      });
    return [...seen.values()];
  }, [expenses, inflow]);

  const materialStats = useCallback((list: Expense[]) => {
    const stats = new Map<
      string,
      {
        key: string;
        name: string;
        qty: number;
        amount: number;
        count: number;
        last: string;
        lastAt: string;
      }
    >();
    for (const x of list) {
      if (isInflow(x) || !x.material) continue;
      const k = x.material.toLowerCase();
      const row = stats.get(k) ?? {
        key: k,
        name: x.material,
        qty: 0,
        amount: 0,
        count: 0,
        last: "",
        lastAt: "",
      };
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
  }, []);

  const topMaterials = useMemo(
    () =>
      materialStats(expenses)
        .sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt))
        .slice(0, 5)
        .map((r) => r.name),
    [expenses, materialStats],
  );
  const materialNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const i of items) if (i.stocked) names.set(key(i.name), i.name);
    for (const r of materialStats(expenses)) if (!names.has(key(r.name))) names.set(key(r.name), r.name);
    return [...names.values()].sort((a, b) => a.localeCompare(b));
  }, [items, expenses, materialStats]);

  /* ---------- totals and the list ---------- */

  const thisMonth = todayISO().slice(0, 7);
  const lastMonth = (() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return todayISO(d).slice(0, 7);
  })();
  const months = useMemo(() => [...new Set(expenses.map((x) => x.date.slice(0, 7)))].sort().reverse(), [expenses]);
  const periodName = period === "this" ? "This month" : period === "last" ? "Last month" : period === "all" ? "All time" : monthName(period);

  const shown = useMemo(
    () =>
      expenses.filter((x) => {
        const m = x.date.slice(0, 7);
        if (period === "this" && m !== thisMonth) return false;
        if (period === "last" && m !== lastMonth) return false;
        if (/^\d{4}-\d{2}$/.test(period) && m !== period) return false;
        if (forFilter !== "all" && x.forWho !== forFilter) return false;
        if (floorFilter !== "all" && x.floor !== floorFilter) return false;
        if (matFilter && (x.material ?? "").toLowerCase() !== matFilter) return false;
        return true;
      }),
    [expenses, period, forFilter, floorFilter, matFilter, thisMonth, lastMonth],
  );

  const monthOut = expenses.filter((x) => x.date.startsWith(thisMonth) && !isInflow(x)).reduce((s, x) => s + x.amount, 0);
  const monthIn = expenses.filter((x) => x.date.startsWith(thisMonth) && isInflow(x)).reduce((s, x) => s + x.amount, 0);

  const outs = shown.filter((x) => !isInflow(x));
  const total = outs.reduce((s, x) => s + x.amount, 0);
  const inTotal = shown.filter(isInflow).reduce((s, x) => s + x.amount, 0);
  const placeSums = new Map<string, number>();
  for (const x of outs) {
    const k = x.floor || (x.forWho !== "Site" ? x.forWho : "Site, no floor");
    placeSums.set(k, (placeSums.get(k) ?? 0) + x.amount);
  }
  const placeOrder = [...FLOORS, ...FOR_WHO.slice(1), "Site, no floor"] as string[];
  const byPlace = [...placeSums.entries()].sort((a, b) => placeOrder.indexOf(a[0]) - placeOrder.indexOf(b[0]));
  const maxPlace = Math.max(0, ...byPlace.map(([, v]) => v));
  const byMethod = METHODS.map((m) => [m, outs.reduce((s, x) => (x.method === m ? s + x.amount : s), 0)] as const).filter(([, v]) => v > 0);
  const byCategory = CATEGORIES.map((c) => [c, outs.reduce((s, x) => (x.category === c ? s + x.amount : s), 0)] as const).filter(([, v]) => v > 0);
  const materialsBought = materialStats(shown).sort((a, b) => b.amount - a.amount);

  const days = useMemo(() => {
    const groups: { date: string; list: Expense[] }[] = [];
    for (const x of shown) {
      const last = groups[groups.length - 1];
      if (last && last.date === x.date) last.list.push(x);
      else groups.push({ date: x.date, list: [x] });
    }
    return groups;
  }, [shown]);

  const exportCsv = async () => {
    const cell = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\r\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [
      [
        "Date",
        "Type",
        "For",
        "Amount (GHS)",
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
      ...shown.map((x) => [
        x.date,
        isInflow(x) ? "Money in" : "Expense",
        x.forWho,
        x.amount.toFixed(2),
        x.supplier,
        x.category ?? "",
        x.material ?? "",
        x.qty ?? "",
        x.toStore ? "yes" : "",
        x.description,
        x.floor ?? "",
        x.method ?? "",
        x.receiptUrl ?? "",
      ]),
    ];
    const csv = "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
    const name = `lexington-expenses-${period === "this" ? thisMonth : period === "last" ? lastMonth : period}.csv`;
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

  const openReceipt = (x: { receiptUrl: string | null; receiptType: string | null }) => {
    if (!x.receiptUrl) return;
    if (pdfType(x.receiptType)) window.open(x.receiptUrl, "_blank", "noopener");
    else setLightbox(x.receiptUrl);
  };

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!isPdf(file) && !file.type.startsWith("image/")) {
      setFormError("That file can't be attached. Use a photo or a PDF.");
      return;
    }
    setFormError("");
    setKept(null);
    receipt.start(file);
  };

  /* ---------- render ---------- */

  return (
    <div className={appClass(me)}>
      <header className={styles.top}>
        <div className={styles.topRow}>
          <div>
            <h1 className={styles.title}>Expenses</h1>
            <p className={styles.counts}>
              Spent this month {money(monthOut)}
              {monthIn ? ` · In ${money(monthIn)}` : ""}
            </p>
          </div>
          <button type="button" className={styles.menuButton} onClick={() => setMenuOpen(true)} aria-label="Menu">
            <span aria-hidden="true">☰</span>
          </button>
        </div>
        <div className={site.headSpace} />
      </header>

      {signedOut && (
        <div className={styles.banner} role="alert">
          You&rsquo;ve been signed out. <a href="/todo/expenses">Sign in again</a>
        </div>
      )}
      {offline && !signedOut && (
        <div className={styles.banner} role="status">
          No signal: showing the expenses as they were. Saving needs a signal.
        </div>
      )}

      <main className={styles.main}>
        <form
          id="exp-form"
          className={`${site.card} ${editing ? site.cardEditing : inflow ? site.cardInflow : ""}`}
          onSubmit={save}
          noValidate
          autoComplete="off"
        >
          {/* Nothing can change while a save is on its way: when it lands the form clears for the next one. */}
          <fieldset className={site.formFields} disabled={saving}>
            <div className={site.kind} role="group" aria-label="Entry type">
              <button
                type="button"
                aria-pressed={!inflow}
                onClick={() => {
                  setKind("expense");
                  setFormError("");
                }}
              >
                Expense
              </button>
              <button
                type="button"
                className={site.kindIn}
                aria-pressed={inflow}
                onClick={() => {
                  setKind("inflow");
                  setFormError("");
                }}
              >
                Money in
              </button>
            </div>
            <div className={site.chipsEven} role="group" aria-label="Who it's for">
              {FOR_WHO.map((f) => (
                <button key={f} type="button" className={forWho === f ? styles.chipOn : styles.chip} aria-pressed={forWho === f} onClick={() => setForWho(f)}>
                  {f}
                </button>
              ))}
            </div>

            <div className={site.formHead}>
              <h2 className={site.formTitle}>
                {editing ? "Edit " : "New "}
                {inflow ? "money in" : "expense"}
              </h2>
              <div className={site.dateBar}>
                <span>{niceDate(date)}</span>
                <button type="button" className={styles.linkButton} onClick={() => setDateOpen(!dateOpen)}>
                  {dateOpen ? "Done" : "Change date"}
                </button>
              </div>
            </div>
            {dateOpen && (
              <input
                className={styles.input}
                type="date"
                aria-label="Date"
                value={date}
                max={todayISO()}
                onChange={(e) => {
                  if (e.target.value) {
                    setDate(e.target.value);
                    setDateTouched(true);
                  }
                }}
              />
            )}

            <label className={styles.label} htmlFor="exp-amount">
              Amount
            </label>
            <div className={site.amount}>
              <span>GH₵</span>
              <input
                id="exp-amount"
                ref={amountRef}
                type="text"
                inputMode="decimal"
                enterKeyHint="next"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>

            {!inflow && (
              <>
                <span className={styles.label}>What for</span>
                <div className={site.chipsEven} role="group" aria-label="What for">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={category === c ? styles.chipOn : styles.chip}
                      aria-pressed={category === c}
                      onClick={() => setCategory(category === c ? null : c)}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </>
            )}

            {isMaterial && (
              <div className={site.matBox}>
                <label className={styles.label} htmlFor="exp-material">
                  Material
                </label>
                <input
                  id="exp-material"
                  className={styles.input}
                  list="exp-material-list"
                  value={material}
                  onChange={(e) => setMaterial(e.target.value)}
                  maxLength={MAX_MATERIAL}
                  autoCapitalize="sentences"
                  placeholder="e.g. Cement 50kg bag"
                />
                <datalist id="exp-material-list">
                  {materialNames.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
                {topMaterials.length > 0 && (
                  <div className={styles.chips} aria-label="Most used materials">
                    {topMaterials.map((n) => (
                      <button key={n} type="button" className={site.smallChip} onClick={() => setMaterial(n)}>
                        {n}
                      </button>
                    ))}
                  </div>
                )}
                <span className={styles.label}>Quantity</span>
                <QtyPicker id="exp-qty" value={qty} onChange={setQty} unit={match?.unit} />

                <button type="button" className={toStore ? site.storeOn : site.storeOff} aria-pressed={toStore} onClick={() => setToStoreChoice(!toStore)}>
                  {toStore ? "✓ Into the store room" : "Not into the store room"}
                </button>
                {toStore &&
                  (match ? (
                    <p className={site.storeNote}>
                      In the store now: {qtyUnit(match.level, match.unit)}. This adds {qtyUnit(qty, match.unit)}.
                    </p>
                  ) : material.trim() ? (
                    <>
                      <p className={site.storeNote}>New in the store room. Counted in:</p>
                      <div className={styles.chips}>
                        {UNITS.map((u) => (
                          <button
                            key={u}
                            type="button"
                            className={unit === u ? styles.chipOn : styles.chip}
                            aria-pressed={unit === u}
                            onClick={() => setUnit(u)}
                          >
                            {u}
                          </button>
                        ))}
                      </div>
                      <input
                        className={styles.input}
                        aria-label="Another unit"
                        placeholder="Or type one, e.g. bundles"
                        maxLength={MAX_UNIT}
                        value={(UNITS as readonly string[]).includes(unit) ? "" : unit}
                        onChange={(e) => setUnit(e.target.value.toLowerCase())}
                      />
                    </>
                  ) : null)}
                {!toStore && match && match.stocked && <p className={site.storeNote}>The stock of {match.name} won&rsquo;t change.</p>}
              </div>
            )}

            <div className={site.row2}>
              <div className={site.field}>
                <label className={styles.label} htmlFor="exp-supplier">
                  {inflow ? "From" : "Supplier"}
                </label>
                <input
                  id="exp-supplier"
                  className={styles.input}
                  list="exp-supplier-list"
                  value={supplier}
                  onChange={(e) => setSupplier(e.target.value)}
                  maxLength={MAX_SUPPLIER}
                  autoCapitalize="words"
                  placeholder={inflow ? "e.g. tenant, buyer, bank" : "e.g. block factory"}
                />
                <datalist id="exp-supplier-list">
                  {suppliers.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>
              <div className={site.field}>
                <label className={styles.label} htmlFor="exp-desc">
                  Description
                </label>
                <input
                  id="exp-desc"
                  className={styles.input}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={MAX_DESCRIPTION}
                  autoCapitalize="sentences"
                  placeholder={inflow ? "e.g. deposit for flat 2B" : "e.g. 40 bags cement"}
                />
              </div>
            </div>
            {suppliers.length > 0 && (
              <div className={styles.chips} aria-label="Recent suppliers">
                {suppliers.slice(0, 5).map((s) => (
                  <button key={s} type="button" className={site.smallChip} onClick={() => setSupplier(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}

            {showFloors && (
              <>
                <span className={styles.label}>Floor / area</span>
                <div className={styles.chips} role="group" aria-label="Floor or area">
                  {FLOORS.map((f) => (
                    <button
                      key={f}
                      type="button"
                      className={floor === f ? styles.chipOn : styles.chip}
                      aria-pressed={floor === f}
                      onClick={() => setFloor(floor === f ? null : f)}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </>
            )}

            <span className={styles.label}>{inflow ? "Received by" : "Paid by"}</span>
            <div className={site.chipsTwo} role="group" aria-label={inflow ? "Received by" : "Paid by"}>
              {METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={method === m ? styles.chipOn : styles.chip}
                  aria-pressed={method === m}
                  onClick={() => setMethod(method === m ? null : m)}
                >
                  {m}
                </button>
              ))}
            </div>

            <span className={styles.label}>Receipt</span>
            {receipt.slot ? (
              <div className={site.preview}>
                {receipt.slot.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element -- the phone's own preview of the photo
                  <img src={receipt.slot.preview} alt="" />
                ) : (
                  <span className={site.pdf}>PDF</span>
                )}
                <span className={receipt.slot.state === "error" ? styles.slotError : site.previewText}>
                  {receipt.slot.state === "uploading" ? "Uploading…" : receipt.slot.state === "ready" ? "Receipt ready" : receipt.slot.error}
                </span>
                <button type="button" className={styles.linkButton} onClick={() => receipt.clear()}>
                  Remove
                </button>
              </div>
            ) : kept ? (
              <div className={site.preview}>
                {pdfType(kept.type) ? (
                  <span className={site.pdf}>PDF</span>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- a resized copy from the image store
                  <img src={photoAt(kept.url, 160)} alt="" />
                )}
                <button
                  type="button"
                  className={site.previewOpen}
                  onClick={() =>
                    openReceipt({
                      receiptUrl: kept.url,
                      receiptType: kept.type,
                    })
                  }
                >
                  Receipt attached
                </button>
                <button type="button" className={styles.linkButton} onClick={() => setKept(null)}>
                  Remove
                </button>
              </div>
            ) : (
              <div className={styles.slotButtons}>
                <label htmlFor={RECEIPT_CAMERA} role="button" tabIndex={0}>
                  📷 Take photo
                </label>
                <label htmlFor={RECEIPT_FILE} role="button" tabIndex={0}>
                  Upload
                </label>
              </div>
            )}
            <input
              id={RECEIPT_CAMERA}
              data-picker="receipt-camera"
              className={styles.hiddenInput}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={pickFile}
            />
            <input
              id={RECEIPT_FILE}
              data-picker="receipt-file"
              className={styles.hiddenInput}
              type="file"
              accept="image/*,application/pdf"
              onChange={pickFile}
            />

            {formError && (
              <p className={styles.sheetError} role="alert">
                {formError}
              </p>
            )}
            <button type="submit" className={inflow ? site.saveIn : site.save} disabled={saving}>
              {saving
                ? receipt.slot?.state === "uploading"
                  ? "Uploading the receipt…"
                  : "Saving…"
                : editing
                  ? "Save changes"
                  : inflow
                    ? "Save money in"
                    : "Save expense"}
            </button>
            {editing && (
              <div className={site.editButtons}>
                <button type="button" className={styles.sheetCancel} onClick={resetForm} disabled={saving}>
                  Cancel
                </button>
                <button type="button" className={armed ? styles.dangerArmed : site.deleteButton} onClick={() => void remove()} disabled={saving}>
                  {armed ? "Tap again to delete" : "Delete"}
                </button>
              </div>
            )}
          </fieldset>
        </form>

        <section className={site.card} aria-label="Totals">
          <div className={site.formHead}>
            <h2 className={site.formTitle}>Totals · {periodName}</h2>
            <button type="button" className={site.exportButton} onClick={() => void exportCsv()} disabled={shown.length === 0}>
              Export CSV
            </button>
          </div>
          <div className={site.filters}>
            <label>
              <span className={styles.smallLabel}>Period</span>
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
              <span className={styles.smallLabel}>For</span>
              <select className={styles.input} value={forFilter} onChange={(e) => setForFilter(e.target.value)}>
                <option value="all">Everything</option>
                {FOR_WHO.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
            <label>
              <span className={styles.smallLabel}>Floor / area</span>
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
              {outs.length} expense{outs.length === 1 ? "" : "s"}
            </strong>
            <strong className={site.num}>{money(total)}</strong>
          </div>
          {outs.length === 0 && <p className={styles.sheetNote}>No expenses recorded for this period yet.</p>}
          {byPlace.map(([place, value]) => (
            <div key={place} className={site.bar}>
              <span>{place}</span>
              <span className={site.track}>
                <span
                  className={site.fill}
                  style={{
                    width: `${maxPlace ? ((value / maxPlace) * 100).toFixed(1) : 0}%`,
                  }}
                />
              </span>
              <span className={site.num}>{money(value)}</span>
            </div>
          ))}
          <div className={site.pills}>
            {inTotal > 0 && (
              <>
                <span className={site.pillIn}>
                  Money in <b>{money(inTotal)}</b>
                </span>
                <span className={site.pill}>
                  Balance <b>{(inTotal - total < 0 ? "−" : "") + money(Math.abs(inTotal - total))}</b>
                </span>
              </>
            )}
            {byMethod.map(([m, v]) => (
              <span key={m} className={site.pill}>
                Paid {m} <b>{money(v)}</b>
              </span>
            ))}
          </div>
          {byCategory.length > 0 && (
            <div className={site.pills}>
              {byCategory.map(([c, v]) => (
                <span key={c} className={site.pill}>
                  {c} <b>{money(v)}</b>
                </span>
              ))}
            </div>
          )}
          {matFilter && (
            <div className={site.matFilter}>
              <span>Showing only: {materialsBought[0]?.name ?? matFilter}</span>
              <button type="button" className={styles.linkButton} onClick={() => setMatFilter(null)}>
                Show all
              </button>
            </div>
          )}
          {materialsBought.length > 0 && (
            <div>
              <h3 className={styles.label}>Materials bought</h3>
              {materialsBought.map((r) => (
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
                      Last bought {niceDate(r.last)} · {r.count} purchase
                      {r.count === 1 ? "" : "s"}
                    </small>
                  </span>
                  <span className={site.num}>× {fmtQty(r.qty)}</span>
                  <span className={site.num}>{money(r.amount)}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section id="exp-list" className={site.ledger} aria-label="Expenses">
          {days.length === 0 ? (
            <p className={styles.empty}>
              {expenses.length
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
                      <div key={x.id} className={`${site.entryCard} ${xIn ? site.entryIn : ""} ${editing?.id === x.id ? site.entryEditing : ""}`}>
                        <button
                          type="button"
                          className={site.entryMain}
                          onClick={() => startEdit(x)}
                          aria-label={`Edit ${x.supplier || (xIn ? "money in" : "expense")} ${money(x.amount)}`}
                        >
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
                          {x.description && <span className={site.desc}>{x.description}</span>}
                        </button>
                        <span className={site.tags}>
                          {x.forWho !== "Site" && <span className={site.tag}>{x.forWho}</span>}
                          {xIn ? <span className={site.tagIn}>Money in</span> : x.floor ? <span className={site.tag}>{x.floor}</span> : null}
                          {x.category && x.category !== "Material" && <span className={site.tagMuted}>{x.category}</span>}
                          <span className={site.tagMuted}>{x.method || "—"}</span>
                          {x.receiptUrl && (
                            <button type="button" className={site.clip} onClick={() => openReceipt(x)}>
                              📎 Receipt
                            </button>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </section>
      </main>

      {menuOpen && <SiteMenu me={me} onClose={() => setMenuOpen(false)} onRefresh={() => void refresh()} onLogins={() => setAccessOpen(true)} />}
      {accessOpen && <AccessSheet onClose={() => setAccessOpen(false)} />}

      {lightbox && (
        <div className={styles.lightbox} onClick={() => setLightbox(null)} role="dialog" aria-label="Receipt">
          {/* eslint-disable-next-line @next/next/no-img-element -- full-size view from the image store */}
          <img src={photoAt(lightbox, 2000)} alt="" />
          <div className={styles.lightboxBar}>
            <a href={lightbox} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
              Full size
            </a>
            <button type="button" onClick={() => setLightbox(null)}>
              Close
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className={`${styles.toast} ${toast.tone === "error" ? styles.toastError : ""}`} role="status">
          <span>{toast.text}</span>
        </div>
      )}

      <SiteNav me={me} current="expenses" />
    </div>
  );
}
