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
  VAT_RATE,
  vatParts,
  type Expense,
  type ForWho,
} from "@/lib/expenses/shared";
import type { ReceiptReading } from "@/lib/expenses/readReceipt";
import { MAX_UNIT, qtyUnit, UNITS, type StoreItem } from "@/lib/store/shared";
import { photoAt } from "@/lib/todo/shared";
import { errorText, send } from "./api";
import { QtyPicker } from "./QtyPicker";
import { forgetReceipt, isPdf, uploadReceipt } from "./receipt";
import site from "./Site.module.css";
import styles from "./Todo.module.css";

// The entry form, as on the old expense page (same buttons in the same order), plus "into the
// store room" for materials and VAT. It keeps its own state, so typing never redraws the totals
// and the list below it.

type Receipt = { id: string; url: string; type: string };
/** A new expense started from the bank's debit text (lib/expenses/bankDebit.ts): what the text gives, and a line saying so. */
export type ExpensePrefill = { debitId: string; date: string; amount: number; method: string | null; supplier: string; description: string; note: string };
const RECEIPT_CAMERA = "exp-receipt-camera";
const RECEIPT_FILE = "exp-receipt-file";

const key = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const pdfType = (type: string | null | undefined) => type === "application/pdf";

export function niceDate(iso: string) {
  const today = todayISO();
  if (iso === today) return "Today";
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (iso === todayISO(y)) return "Yesterday";
  const [yy, mm, dd] = iso.split("-").map(Number);
  const d = new Date(yy, mm - 1, dd);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: yy === new Date().getFullYear() ? undefined : "numeric" });
}

/* ---------- the receipt being added (uploads as soon as it's picked) ---------- */

type Slot = { preview: string | null; name: string; pdf: boolean; state: "uploading" | "ready" | "error"; stored?: Receipt; error?: string };

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
      return { preview, name: file.name || (pdf ? "Receipt.pdf" : "Photo"), pdf, state: "uploading" };
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
      }
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

/* ---------- the form ---------- */

export function ExpenseForm({
  editing,
  expenses,
  items,
  onSaved,
  onDeleted,
  onCancel,
  onBusy,
  onOpenReceipt,
  focusAmount,
  prefill,
}: {
  /** The entry being changed; null for a new one. */
  editing: Expense | null;
  /** A new one made from a bank debit waiting in the app. */
  prefill?: ExpensePrefill | null;
  expenses: Expense[];
  items: StoreItem[];
  onSaved: (expense: Expense, wasEdit: boolean) => void;
  onDeleted: (expense: Expense) => void;
  onCancel: () => void;
  onBusy: (busy: boolean) => void;
  onOpenReceipt: (x: Expense) => void;
  /** Straight after a save: ready for the next amount, as on the old page. */
  focusAmount?: boolean;
}) {
  const x = editing;
  const p = x ? null : (prefill ?? null);
  const [kind, setKind] = useState<"expense" | "inflow">(x?.kind ?? "expense");
  const [forWho, setForWho] = useState<ForWho>(x?.forWho ?? "Site");
  const [date, setDate] = useState(() => x?.date ?? p?.date ?? todayISO());
  const [dateTouched, setDateTouched] = useState(!!x || !!p);
  const [dateOpen, setDateOpen] = useState(false);
  const [amount, setAmount] = useState(x ? (x.amount || 0).toFixed(2) : p ? p.amount.toFixed(2) : "");
  const [vat, setVat] = useState(x?.vat ?? false);
  const [vatRate, setVatRate] = useState(String(x?.vatRate ?? VAT_RATE));
  const [category, setCategory] = useState<string | null>(x?.category ?? null);
  const [material, setMaterial] = useState(x?.material ?? "");
  const [qty, setQty] = useState(x?.qty || 1);
  const [toStoreChoice, setToStoreChoice] = useState<boolean | null>(x?.category === "Material" ? x.toStore : null);
  const [unit, setUnit] = useState("pcs");
  const [supplier, setSupplier] = useState(x?.supplier ?? p?.supplier ?? "");
  const [description, setDescription] = useState(x?.description ?? p?.description ?? "");
  const [floor, setFloor] = useState<string | null>(x?.floor ?? null);
  const [method, setMethod] = useState<string | null>(x?.method ?? p?.method ?? null);
  const [kept, setKept] = useState<Receipt | null>(x?.receiptId && x.receiptUrl ? { id: x.receiptId, url: x.receiptUrl, type: x.receiptType ?? "image/jpeg" } : null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [armed, setArmed] = useState(false);
  const receipt = useReceiptSlot();
  const amountRef = useRef<HTMLInputElement>(null);
  // Receipt first: a new entry's receipt is read as soon as it's uploaded, and fills what's still empty.
  const [reading, setReading] = useState<{ state: "reading" | "done" | "failed"; note: string } | null>(null);
  const readFor = useRef<string | null>(null);
  const now = useRef({ amount, supplier, description, category, material, qty, vat, method, dateTouched, kind });
  useEffect(() => {
    now.current = { amount, supplier, description, category, material, qty, vat, method, dateTouched, kind };
  });

  // Past midnight with the page still open: a new entry is for the new day.
  useEffect(() => {
    const timer = setInterval(() => {
      if (!dateTouched) setDate((d) => (d === todayISO() ? d : todayISO()));
    }, 60_000);
    return () => clearInterval(timer);
  }, [dateTouched]);

  useEffect(() => {
    if (focusAmount) amountRef.current?.focus();
    // On opening only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The parent locks the list while a save is on its way.
  useEffect(() => onBusy(saving), [saving, onBusy]);

  /** Puts what the receipt says into the fields that are still empty (what was typed stays). */
  const fillFrom = useCallback((r: ReceiptReading) => {
    if (!r.readable) {
      setReading({ state: "failed", note: ["The app couldn't read this as a receipt: fill in the form yourself.", ...r.notes].join(" ") });
      return;
    }
    const v = now.current;
    const filled: string[] = [];
    if (r.amount && !v.amount.trim()) {
      setAmount(r.amount.toFixed(2));
      filled.push("amount");
    }
    if (r.date && !v.dateTouched) {
      setDate(r.date);
      setDateTouched(true);
      filled.push("date");
    }
    if (r.supplier && !v.supplier.trim()) {
      setSupplier(r.supplier);
      filled.push(v.kind === "inflow" ? "from" : "supplier");
    }
    if (r.description && !v.description.trim()) {
      setDescription(r.description);
      filled.push("description");
    }
    if (r.vat && !v.vat) {
      setVat(true);
      if (r.vatRate) setVatRate(String(r.vatRate));
      filled.push("VAT");
    }
    if (r.method && !v.method) {
      setMethod(r.method);
      filled.push(v.kind === "inflow" ? "received by" : "paid by");
    }
    if (v.kind !== "inflow") {
      if (r.category && !v.category) {
        setCategory(r.category);
        filled.push("what for");
      }
      if ((v.category ?? r.category) === "Material") {
        if (r.material && !v.material.trim()) {
          setMaterial(r.material);
          filled.push("material");
        }
        if (r.qty && v.qty === 1) {
          setQty(r.qty);
          filled.push("quantity");
        }
      }
    }
    const seen = [r.invoiceNumber ? `receipt no. ${r.invoiceNumber}` : "", r.supplierTin ? `supplier TIN ${r.supplierTin}` : ""].filter(Boolean).join(", ");
    setReading({
      state: "done",
      note: [
        filled.length ? `Filled in from the receipt: ${filled.join(", ")}. Check them before saving.` : "Read the receipt: everything it shows was already filled in.",
        seen ? `It also shows ${seen}.` : "",
        ...r.notes,
      ]
        .filter(Boolean)
        .join(" "),
    });
  }, []);

  const stored = receipt.slot?.state === "ready" ? receipt.slot.stored : undefined;
  useEffect(() => {
    if (x || !stored || readFor.current === stored.id) return;
    const id = stored.id;
    readFor.current = id;
    setReading({ state: "reading", note: "Reading the receipt…" });
    send<{ reading: ReceiptReading }>("/api/expenses/receipt/read", "POST", { receiptId: id }).then(
      ({ reading: r }) => {
        if (readFor.current === id) fillFrom(r);
      },
      (e) => {
        if (readFor.current === id) setReading({ state: "failed", note: `${errorText(e)} Fill in the form yourself.` });
      }
    );
  }, [x, stored, fillFrom]);

  const removeReceipt = () => {
    readFor.current = null;
    setReading(null);
    receipt.clear();
  };

  const inflow = kind === "inflow";
  const isMaterial = !inflow && category === "Material";
  const match = useMemo(() => (material.trim() ? items.find((i) => key(i.name) === key(material)) : undefined), [items, material]);
  const toStore = isMaterial && (toStoreChoice ?? (forWho === "Site" && (match ? match.stocked : true)));
  const showFloors = !inflow && forWho === "Site";

  const parsedAmount = () => {
    const n = parseFloat(amount.replace(/[^0-9.,]/g, "").replace(/,/g, ""));
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  };
  const rate = Number(vatRate);
  const vatPreview = vat && parsedAmount() > 0 && rate > 0 ? vatParts(parsedAmount(), rate) : null;
  const hasReceipt = !!receipt.slot || !!kept;

  // New money in with the same day and amount as one already in (often the bank's text added it):
  // saving it again would count it twice.
  const twins = useMemo(() => {
    const value = Math.round(parseFloat(amount.replace(/[^0-9.,]/g, "").replace(/,/g, "")) * 100) / 100;
    if (x || !inflow || !(value > 0)) return [];
    return expenses.filter((e) => isInflow(e) && e.date === date && Math.abs(e.amount - value) < 0.005);
  }, [x, inflow, amount, date, expenses]);

  /* ---------- suggestions ---------- */

  const suppliers = useMemo(() => {
    const seen = new Map<string, string>();
    [...expenses]
      .filter((e) => isInflow(e) === inflow)
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
      .forEach((e) => {
        const s = e.supplier.trim();
        if (s && !seen.has(s.toLowerCase())) seen.set(s.toLowerCase(), s);
      });
    return [...seen.values()];
  }, [expenses, inflow]);
  const materials = useMemo(() => {
    const stats = new Map<string, { name: string; count: number; lastAt: string }>();
    for (const e of expenses) {
      if (isInflow(e) || !e.material) continue;
      const k = e.material.toLowerCase();
      const row = stats.get(k) ?? { name: e.material, count: 0, lastAt: "" };
      row.count++;
      if ((e.createdAt ?? "") > row.lastAt) {
        row.lastAt = e.createdAt ?? "";
        row.name = e.material;
      }
      stats.set(k, row);
    }
    const top = [...stats.values()].sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt)).slice(0, 5).map((r) => r.name);
    const names = new Map<string, string>();
    for (const i of items) if (i.stocked) names.set(key(i.name), i.name);
    for (const r of stats.values()) if (!names.has(key(r.name))) names.set(key(r.name), r.name);
    return { top, all: [...names.values()].sort((a, b) => a.localeCompare(b)) };
  }, [expenses, items]);

  /* ---------- saving ---------- */

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const value = parsedAmount();
    if (!(value > 0)) {
      setError(inflow ? "Enter the amount received." : "Enter the amount paid.");
      amountRef.current?.focus();
      return;
    }
    if (vat && !(rate > 0 && rate <= 50)) return setError("Type the VAT rate in percent, e.g. 20.");
    if (showFloors && !floor) return setError("Pick the floor or area.");
    if (!inflow && !category) return setError("Pick Material, Service or Other.");
    if (isMaterial && !material.trim()) return setError("Write which material you bought.");
    if (!method) return setError(inflow ? "Pick how the money came in." : "Pick how it was paid.");
    if (vat && !hasReceipt) return setError("With VAT, the receipt is a must: take a photo of it or upload it.");
    setError("");
    setSaving(true);
    try {
      let receiptId = kept?.id ?? null;
      if (receipt.slot) {
        const stored = await receipt.settled();
        if (!stored) {
          setError("The receipt didn't upload. Try it again, or remove it to save without it.");
          return;
        }
        receiptId = stored.id;
      }
      const body = {
        date,
        kind,
        forWho,
        amount: value,
        vat,
        vatRate: vat ? rate : null,
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
        // Made from a bank debit: that debit is done once this is saved.
        ...(p ? { bankDebitId: p.debitId } : {}),
      };
      const { expense } = x
        ? await send<{ expense: Expense }>(`/api/expenses/${x.id}`, "PATCH", body)
        : await send<{ expense: Expense }>("/api/expenses", "POST", body);
      receipt.clear(true);
      readFor.current = null;
      setReading(null);
      setSaving(false);
      onSaved(expense, !!x);
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!x) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    setSaving(true);
    try {
      await send(`/api/expenses/${x.id}`, "DELETE");
      setSaving(false);
      onDeleted(x);
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  };

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!isPdf(file) && !file.type.startsWith("image/")) {
      setError("That file can't be attached. Use a photo or a PDF.");
      return;
    }
    setError("");
    setKept(null);
    receipt.start(file);
  };

  return (
    <form id="exp-form" className={`${site.card} ${x ? site.cardEditing : inflow ? site.cardInflow : ""}`} onSubmit={save} noValidate autoComplete="off">
      {/* Nothing can change while a save is on its way: when it lands the form clears for the next one. */}
      <fieldset className={site.formFields} disabled={saving}>
        <div className={site.kind} role="group" aria-label="Entry type">
          <button
            type="button"
            aria-pressed={!inflow}
            onClick={() => {
              setKind("expense");
              setError("");
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
              setError("");
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

        {p && (
          <p className={site.storeNote} role="status">
            {p.note}
          </p>
        )}
        {!x && !receipt.slot && !kept && (
          <div className={site.receiptFirst}>
            <span>Have the receipt? Start with it: the app reads it and fills in the rest.</span>
            <div className={styles.slotButtons}>
              <label htmlFor={RECEIPT_CAMERA} role="button" tabIndex={0}>
                📷 Photo of the receipt
              </label>
              <label htmlFor={RECEIPT_FILE} role="button" tabIndex={0}>
                Upload
              </label>
            </div>
          </div>
        )}
        {reading && (
          <p className={reading.state === "failed" ? site.receiptNeeded : site.storeNote} role="status" aria-live="polite">
            {reading.note}
          </p>
        )}
        {x?.bank && (
          <p className={site.storeNote}>
            {x.bank.matched ? "Confirmed by your bank's text" : "Added by your bank's text"} of {niceDate(x.bank.at.slice(0, 10))}
            {x.bank.at.length > 10 ? `, ${x.bank.at.slice(11)}` : ""} (account ending {x.bank.account.replace(/^.*x/, "")}).
            {x.bank.matched ? "" : " Not from Leo? Change who it's from below, or delete it."}
          </p>
        )}

        <div className={site.formHead}>
          <h2 className={site.formTitle}>
            {x ? `Edit ${x.ref ?? ""} ` : "New "}
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
          <input id="exp-amount" ref={amountRef} type="text" inputMode="decimal" enterKeyHint="next" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        {twins.length > 0 && (
          <p className={site.receiptNeeded} role="status">
            Already in for this day:{" "}
            {twins
              .map((t) => `${t.ref ?? "an entry"}, ${money(t.amount)}${t.supplier ? ` from ${t.supplier}` : ""}${t.bank && !t.bank.matched ? " (added by your bank's text)" : ""}`)
              .join("; ")}
            . Only save this if it&rsquo;s another payment.
          </p>
        )}
        <div className={site.vatRow} role="group" aria-label="VAT">
          <button type="button" className={!vat ? styles.chipOn : styles.chip} aria-pressed={!vat} onClick={() => setVat(false)}>
            No VAT
          </button>
          <button type="button" className={vat ? styles.chipOn : styles.chip} aria-pressed={vat} onClick={() => setVat(true)}>
            VAT included
          </button>
        </div>
        {vat && (
          <>
            <label className={site.vatRate}>
              <span>VAT rate</span>
              <input type="text" inputMode="decimal" value={vatRate} onChange={(e) => setVatRate(e.target.value.replace(/[^0-9.]/g, ""))} aria-label="VAT rate in percent" />
              <span>%</span>
            </label>
            {vatPreview && (
              <p className={site.vatNote}>
                VAT <b>{money(vatPreview.vat)}</b> · before VAT <b>{money(vatPreview.net)}</b>
              </p>
            )}
          </>
        )}

        {!inflow && (
          <>
            <span className={styles.label}>What for</span>
            <div className={site.chipsEven} role="group" aria-label="What for">
              {CATEGORIES.map((c) => (
                <button key={c} type="button" className={category === c ? styles.chipOn : styles.chip} aria-pressed={category === c} onClick={() => setCategory(category === c ? null : c)}>
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
              {materials.all.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            {materials.top.length > 0 && (
              <div className={styles.chips} aria-label="Most used materials">
                {materials.top.map((n) => (
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
                      <button key={u} type="button" className={unit === u ? styles.chipOn : styles.chip} aria-pressed={unit === u} onClick={() => setUnit(u)}>
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
                <button key={f} type="button" className={floor === f ? styles.chipOn : styles.chip} aria-pressed={floor === f} onClick={() => setFloor(floor === f ? null : f)}>
                  {f}
                </button>
              ))}
            </div>
          </>
        )}

        <span className={styles.label}>{inflow ? "Received by" : "Paid by"}</span>
        <div className={site.chipsTwo} role="group" aria-label={inflow ? "Received by" : "Paid by"}>
          {METHODS.map((m) => (
            <button key={m} type="button" className={method === m ? styles.chipOn : styles.chip} aria-pressed={method === m} onClick={() => setMethod(method === m ? null : m)}>
              {m}
            </button>
          ))}
        </div>

        <span className={styles.label}>{vat ? "Receipt (needed for VAT)" : "Receipt"}</span>
        {receipt.slot ? (
          <div className={site.preview}>
            {receipt.slot.preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- the phone's own preview of the photo
              <img src={receipt.slot.preview} alt="" />
            ) : (
              <span className={site.pdf}>PDF</span>
            )}
            <span className={receipt.slot.state === "error" ? styles.slotError : site.previewText}>
              {receipt.slot.state === "uploading"
                ? "Uploading…"
                : receipt.slot.state === "ready"
                  ? reading?.state === "reading"
                    ? "Reading the receipt…"
                    : "Receipt ready"
                  : receipt.slot.error}
            </span>
            <button type="button" className={styles.linkButton} onClick={removeReceipt}>
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
            <button type="button" className={site.previewOpen} onClick={() => x && onOpenReceipt({ ...x, receiptUrl: kept.url, receiptType: kept.type })}>
              Receipt attached
            </button>
            <button type="button" className={styles.linkButton} onClick={() => setKept(null)}>
              Remove
            </button>
          </div>
        ) : (
          <>
            {vat && <p className={site.receiptNeeded}>Take a photo of the VAT receipt or upload it.</p>}
            <div className={styles.slotButtons}>
              <label htmlFor={RECEIPT_CAMERA} role="button" tabIndex={0}>
                📷 Take photo
              </label>
              <label htmlFor={RECEIPT_FILE} role="button" tabIndex={0}>
                Upload
              </label>
            </div>
          </>
        )}
        <input id={RECEIPT_CAMERA} data-picker="receipt-camera" className={styles.hiddenInput} type="file" accept="image/*" capture="environment" onChange={pickFile} />
        <input id={RECEIPT_FILE} data-picker="receipt-file" className={styles.hiddenInput} type="file" accept="image/*,application/pdf" onChange={pickFile} />

        {error && (
          <p className={styles.sheetError} role="alert">
            {error}
          </p>
        )}
        <button type="submit" className={inflow ? site.saveIn : site.save} disabled={saving}>
          {saving ? (receipt.slot?.state === "uploading" ? "Uploading the receipt…" : "Saving…") : x ? "Save changes" : inflow ? "Save money in" : "Save expense"}
        </button>
        {x && (
          <div className={site.editButtons}>
            <button type="button" className={styles.sheetCancel} onClick={onCancel} disabled={saving}>
              Cancel
            </button>
            <button type="button" className={armed ? styles.dangerArmed : site.deleteButton} onClick={() => void remove()} disabled={saving}>
              {armed ? "Tap again to delete" : "Delete"}
            </button>
          </div>
        )}
        {p && (
          <button type="button" className={styles.sheetCancel} onClick={onCancel} disabled={saving}>
            Not now: keep it waiting
          </button>
        )}
      </fieldset>
    </form>
  );
}
