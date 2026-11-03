"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { money, type Expense } from "@/lib/expenses/shared";
import { ghanaDay } from "@/lib/store/shared";
import { paymentsTo, type BillState, type OpenBill, type QboVendor, type SupplierRow, type SuppliersPage } from "@/lib/suppliers/shared";
import type { TodoMe } from "@/lib/todo/shared";
import { AccessSheet } from "./AccessSheet";
import { errorText, send, startPolling } from "./api";
import { niceDate } from "./ExpenseForm";
import { SiteHeader, SiteMenu } from "./SiteChrome";
import { PhotoField } from "./StoreBits";
import sp from "./Suppliers.module.css";
import styles from "./Todo.module.css";
import { useUploadSlot } from "./useUploadSlot";

// Suppliers and their bills (lib/suppliers/shared.ts says what and why): QuickBooks' supplier list with what each is
// owed (their open bills) and what was paid to them; a supplier's page with their bills and every payment to them;
// "+ New bill" (it goes into QuickBooks as a Bill); "Pay" opens the expense form filled in for that bill.

type ToastData = { text: string; tone?: "error" };
/** What "Pay" hands the expense form. */
export type BillPayment = { billId: string; supplier: string; amount: number; description: string; bill: OpenBill };

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dueWords = (b: Pick<BillState, "due" | "left" | "overdue">, today: string) =>
  !b.due ? "no due date" : b.left <= 0 ? `was due ${niceDate(b.due)}` : b.overdue ? `overdue since ${niceDate(b.due)}` : b.due === today ? "due today" : `due ${niceDate(b.due)}`;

export function SuppliersApp({
  me,
  active,
  initial,
  startedOffline,
  fresh,
  onPay,
}: {
  me: TodoMe;
  active: boolean;
  initial: SuppliersPage | null;
  startedOffline: boolean;
  fresh: boolean;
  /** "Pay" on a bill: the expense form, filled in for it. */
  onPay: (payment: BillPayment) => void;
}) {
  const [data, setData] = useState<SuppliersPage | null>(initial);
  const [offline, setOffline] = useState(startedOffline);
  const [signedOut, setSignedOut] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [find, setFind] = useState("");
  const [billSheet, setBillSheet] = useState<{ bill: BillState | null; vendorId: string | null } | null>(null);
  const [supplierSheet, setSupplierSheet] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const inFlight = useRef(false);
  const lastLoadedAt = useRef(0);
  const localAt = useRef(0);
  const skipFirst = useRef(fresh);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showToast = useCallback((t: ToastData) => {
    clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const startedAt = Date.now();
    try {
      const response = await fetch("/api/suppliers", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        setSignedOut(true);
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      const next = (await response.json()) as SuppliersPage;
      lastLoadedAt.current = Date.now();
      setOffline(false);
      if (startedAt >= localAt.current) setData(next);
    } catch {
      setOffline(true);
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    if (skipFirst.current) skipFirst.current = false;
    else if (Date.now() - lastLoadedAt.current > 4_000) void refresh();
    return startPolling(refresh, 60_000, 180_000);
  }, [active, refresh]);

  // The very first open: QuickBooks' list is being read just now, so look again in a few seconds, not a minute.
  const emptyTries = useRef(0);
  useEffect(() => {
    if (!active || !data?.connected || data.fetchedAt || emptyTries.current >= 10) return;
    const timer = setTimeout(() => {
      emptyTries.current += 1;
      void refresh();
    }, 3_000);
    return () => clearTimeout(timer);
  }, [active, data, refresh]);

  const put = (next: SuppliersPage) => {
    localAt.current = Date.now();
    setData(next);
  };

  const today = data?.today ?? ghanaDay();
  const q = find.trim().toLowerCase();
  const rows = useMemo(() => (data?.suppliers ?? []).filter((r) => !q || r.vendor.name.toLowerCase().includes(q) || r.vendor.company.toLowerCase().includes(q)), [data, q]);
  const owing = rows.filter((r) => r.owed > 0);
  const rest = rows.filter((r) => r.owed <= 0);
  const open = openId ? (data?.suppliers.find((r) => r.vendor.id === openId) ?? null) : null;
  const openBills = data?.bills.filter((b) => b.left > 0) ?? [];

  return (
    <>
      <SiteHeader
        title={open ? open.vendor.name : "Suppliers"}
        sub={
          !data
            ? "Loading…"
            : open
              ? open.owed > 0
                ? `${money(open.owed)} owed · ${open.openBills} ${open.openBills === 1 ? "bill" : "bills"} open`
                : "Nothing owed"
              : data.owed > 0
                ? `${money(data.owed)} owed · ${openBills.length} ${openBills.length === 1 ? "bill" : "bills"} open`
                : "Nothing owed"
        }
        onMenu={() => setMenuOpen(true)}
      />
      {signedOut && (
        <div className={styles.banner} role="alert">
          You&rsquo;ve been signed out. <a href="/todo/suppliers">Sign in again</a>
        </div>
      )}
      {offline && !signedOut && (
        <div className={styles.banner} role="status">
          No signal: showing the suppliers as they were. Bills need a signal.
        </div>
      )}

      <main className={styles.main}>
        {!data ? (
          <p className={styles.loading}>Loading the suppliers…</p>
        ) : open ? (
          <SupplierView
            row={open}
            data={data}
            onBack={() => setOpenId(null)}
            onNewBill={() => setBillSheet({ bill: null, vendorId: open.vendor.id })}
            onBill={(b) => setBillSheet({ bill: b, vendorId: b.vendorId })}
            onPay={(b) =>
              onPay({
                billId: b.id,
                supplier: b.supplier,
                amount: b.left,
                description: `Pays ${b.appRef ?? "the bill"}${b.ref ? ` (their ${b.ref})` : ""}: ${b.description}`.slice(0, 200),
                bill: { id: b.id, appRef: b.appRef, supplier: b.supplier, description: b.description, amount: b.amount, left: b.left, due: b.due },
              })
            }
          />
        ) : (
          <>
            <div className={sp.addBar}>
              <button type="button" className={styles.addPhoto} onClick={() => setBillSheet({ bill: null, vendorId: null })} disabled={!data.suppliers.length}>
                + New bill
              </button>
              {data.connected && (
                <button type="button" className={styles.addWrite} onClick={() => setSupplierSheet(true)}>
                  + Supplier
                </button>
              )}
            </div>
            {!data.suppliers.length ? (
              <p className={styles.empty}>
                {data.connected ? "Reading the suppliers from QuickBooks…" : "Connect QuickBooks (on the QuickBooks page) and its supplier list comes in here."}
              </p>
            ) : (
              <>
                <input className={styles.input} type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a supplier…" aria-label="Find a supplier" />
                {owing.length > 0 && (
                  <section className={styles.group} aria-label="Owed">
                    <h2 className={styles.groupTitle}>
                      Owed <span>{money(owing.reduce((n, r) => n + r.owed, 0))}</span>
                    </h2>
                    <div className={sp.list}>{owing.map((r) => <SupplierLine key={r.vendor.id} row={r} today={today} onOpen={() => setOpenId(r.vendor.id)} />)}</div>
                  </section>
                )}
                <section className={styles.group} aria-label="All suppliers">
                  <h2 className={styles.groupTitle}>
                    {owing.length ? "The others" : "Suppliers"} <span>{rest.length}</span>
                  </h2>
                  <div className={sp.list}>{rest.map((r) => <SupplierLine key={r.vendor.id} row={r} today={today} onOpen={() => setOpenId(r.vendor.id)} />)}</div>
                </section>
                <p className={sp.small}>
                  The list is QuickBooks&rsquo; suppliers{data.fetchedAt ? `, read ${niceDate(data.fetchedAt.slice(0, 10))} ${new Date(data.fetchedAt).toISOString().slice(11, 16)}` : ""}. A bill goes into QuickBooks as a bill; its payment as that bill&rsquo;s payment.
                </p>
              </>
            )}
          </>
        )}
      </main>

      {billSheet && data && (
        <BillSheet
          data={data}
          bill={billSheet.bill}
          vendorId={billSheet.vendorId}
          onClose={() => setBillSheet(null)}
          onSaved={(next, text) => {
            put(next);
            setBillSheet(null);
            showToast({ text });
          }}
        />
      )}
      {supplierSheet && (
        <SupplierSheet
          onClose={() => setSupplierSheet(false)}
          onSaved={(next, vendor) => {
            put(next);
            setSupplierSheet(false);
            setOpenId(vendor.id);
            showToast({ text: `${vendor.name} is in QuickBooks and on the list` });
          }}
        />
      )}
      {menuOpen && <SiteMenu me={me} onClose={() => setMenuOpen(false)} onRefresh={() => void refresh()} onLogins={() => setAccessOpen(true)} />}
      {accessOpen && <AccessSheet onClose={() => setAccessOpen(false)} />}
      {toast && (
        <div className={`${styles.toast} ${toast.tone === "error" ? styles.toastError : ""}`} role="status">
          <span>{toast.text}</span>
        </div>
      )}
    </>
  );
}

function SupplierLine({ row: r, today, onOpen }: { row: SupplierRow; today: string; onOpen: () => void }) {
  return (
    <button type="button" className={sp.row} onClick={onOpen}>
      <span className={sp.rowText}>
        <b>{r.vendor.name}</b>
        <small>
          {r.owed > 0
            ? `${r.openBills} ${r.openBills === 1 ? "bill" : "bills"}${r.overdue ? `, ${r.overdue} overdue` : r.nextDue ? ` · next due ${r.nextDue === today ? "today" : niceDate(r.nextDue)}` : ""}`
            : r.paidTotal > 0
              ? `Paid ${money(r.paidTotal)}${r.lastPaid ? ` · last ${niceDate(r.lastPaid)}` : ""}`
              : "Nothing paid yet"}
        </small>
      </span>
      {r.owed > 0 && <span className={r.overdue ? sp.owedLate : sp.owed}>{money(r.owed)}</span>}
    </button>
  );
}

function SupplierView({
  row: r,
  data,
  onBack,
  onNewBill,
  onBill,
  onPay,
}: {
  row: SupplierRow;
  data: SuppliersPage;
  onBack: () => void;
  onNewBill: () => void;
  onBill: (b: BillState) => void;
  onPay: (b: BillState) => void;
}) {
  const [showPaid, setShowPaid] = useState(false);
  const bills = data.bills.filter((b) => b.vendorId === r.vendor.id);
  const openBills = bills.filter((b) => b.left > 0);
  const paidBills = bills.filter((b) => b.left <= 0);
  // Every payment to them: by their name in the expenses, or paying one of their bills.
  const payments: Expense[] = useMemo(() => paymentsTo(r.vendor, data.bills, data.payments), [r.vendor, data.bills, data.payments]);
  const billRef = (id: string | null) => (id ? (data.bills.find((b) => b.id === id)?.appRef ?? "a bill") : null);
  const qboDiffers = Math.abs((r.vendor.balance || 0) - r.owed) >= 0.01;

  return (
    <>
      <button type="button" className={sp.back} onClick={onBack}>
        ‹ All suppliers
      </button>
      <section className={sp.card} aria-label="Owed">
        <p className={r.owed > 0 ? sp.big : `${sp.big} ${sp.bigNone}`}>{r.owed > 0 ? `${money(r.owed)} owed` : "Nothing owed"}</p>
        {(r.vendor.phone || r.vendor.email) && (
          <p className={sp.line}>
            {r.vendor.phone && <a href={`tel:${r.vendor.phone.replace(/[^\d+]/g, "")}`}>{r.vendor.phone}</a>}
            {r.vendor.phone && r.vendor.email ? " · " : ""}
            {r.vendor.email}
          </p>
        )}
        <p className={sp.line}>Paid to them in all: {money(r.paidTotal)}</p>
        {qboDiffers && <p className={sp.warn}>QuickBooks says {money(r.vendor.balance)} is owed (bills entered there, or not gone in yet).</p>}
        <button type="button" className={sp.newBill} onClick={onNewBill}>
          + New bill from {r.vendor.name}
        </button>
      </section>

      <h2 className={styles.groupTitle}>
        Bills to pay <span>{openBills.length}</span>
      </h2>
      {openBills.length === 0 ? (
        <p className={sp.small}>None open.</p>
      ) : (
        <div className={sp.bills}>
          {openBills.map((b) => (
            <BillCard key={b.id} bill={b} today={data.today} onOpen={() => onBill(b)} onPay={() => onPay(b)} />
          ))}
        </div>
      )}
      {paidBills.length > 0 && (
        <>
          <button type="button" className={styles.linkButton} onClick={() => setShowPaid(!showPaid)}>
            {showPaid ? "Hide" : "Show"} {paidBills.length} paid {paidBills.length === 1 ? "bill" : "bills"}
          </button>
          {showPaid && (
            <div className={sp.bills}>
              {paidBills.map((b) => (
                <BillCard key={b.id} bill={b} today={data.today} onOpen={() => onBill(b)} />
              ))}
            </div>
          )}
        </>
      )}

      <h2 className={styles.groupTitle}>
        Payments <span>{payments.length}</span>
      </h2>
      {payments.length === 0 ? (
        <p className={sp.small}>Nothing paid to them in the expenses yet.</p>
      ) : (
        <ul className={sp.payments}>
          {payments.map((x) => (
            <li key={x.id}>
              <span>
                {niceDate(x.date)} · <b>{money(x.amount)}</b> · {x.method ?? "?"}
                {x.description ? ` · ${x.description}` : x.material ? ` · ${x.material}` : ""}
              </span>
              <small>
                {x.ref ?? ""}
                {x.billId ? ` · pays ${billRef(x.billId)}` : ""}
              </small>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function BillCard({ bill: b, today, onOpen, onPay }: { bill: BillState; today: string; onOpen: () => void; onPay?: () => void }) {
  return (
    <article className={b.overdue ? `${sp.bill} ${sp.billLate}` : sp.bill} aria-label={`Bill ${b.appRef ?? ""}`}>
      <button type="button" className={sp.billMain} onClick={onOpen}>
        <span>
          <small>
            {b.appRef}
            {b.ref ? ` · their ${b.ref}` : ""} · {niceDate(b.date)}
          </small>
          <b>{b.description}</b>
          <small className={b.overdue ? sp.lateWords : undefined}>{dueWords(b, today)}</small>
        </span>
        <span className={sp.billAmounts}>
          <b>{money(b.left > 0 ? b.left : b.amount)}</b>
          <small>{b.left > 0 ? (b.paid > 0 ? `left of ${money(b.amount)}` : "to pay") : "paid"}</small>
        </span>
      </button>
      {b.qboError && <p className={sp.warn}>QuickBooks: {b.qboError}</p>}
      {onPay && (
        <button type="button" className={sp.pay} onClick={onPay}>
          Pay {money(b.left)}
        </button>
      )}
    </article>
  );
}

function BillSheet({
  data,
  bill,
  vendorId,
  onClose,
  onSaved,
}: {
  data: SuppliersPage;
  bill: BillState | null;
  vendorId: string | null;
  onClose: () => void;
  onSaved: (next: SuppliersPage, text: string) => void;
}) {
  const today = data.today;
  const [vendor, setVendor] = useState(bill?.vendorId ?? vendorId ?? "");
  const [find, setFind] = useState("");
  const [date, setDate] = useState(bill?.date ?? today);
  const [due, setDue] = useState(bill?.due ?? "");
  const [amount, setAmount] = useState(bill ? String(bill.amount) : "");
  const [description, setDescription] = useState(bill?.description ?? "");
  const [ref, setRef] = useState(bill?.ref ?? "");
  const [floor, setFloor] = useState(bill?.floor ?? "");
  const [cls, setCls] = useState(bill?.costClass?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState("");
  const { slot, start, clear, settled } = useUploadSlot("/api/suppliers/photo");
  const chosen = data.suppliers.find((r) => r.vendor.id === vendor)?.vendor ?? null;
  const q = find.trim().toLowerCase();
  const matches = q ? data.suppliers.filter((r) => r.vendor.name.toLowerCase().includes(q)).slice(0, 8) : [];
  const paid = !!bill && bill.paid > 0;

  const run = async (body: Record<string, unknown>, text: string): Promise<boolean> => {
    setSaving(true);
    setError("");
    try {
      onSaved(await send<SuppliersPage>("/api/suppliers", "POST", body), text);
      return true;
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
      return false;
    }
  };
  const save = async () => {
    if (!chosen) return setError("Pick the supplier.");
    if (!(Number(amount.replace(/,/g, "")) > 0)) return setError("Type the bill's amount.");
    if (!description.trim()) return setError("Say what the bill is for.");
    let photoId: string | null | undefined = undefined;
    if (slot) {
      const photo = await settled();
      if (!photo) return setError("The photo didn't upload. Take it again, or remove it.");
      photoId = photo.id;
    }
    const c = data.classes.find((x) => x.id === cls);
    const ok = await run(
      {
        action: "bill",
        ...(bill ? { id: bill.id } : {}),
        vendorId: chosen.id,
        date,
        due: due || null,
        amount: amount.replace(/,/g, ""),
        description: description.trim(),
        ref: ref.trim(),
        floor: floor || null,
        costClass: c ? { id: c.id, name: c.name } : null,
        ...(photoId !== undefined ? { photoId } : {}),
      },
      bill ? "Bill changed" : `Bill from ${chosen.name}: ${money(Number(amount.replace(/,/g, "")))}`
    );
    // Saved: the photo is the bill's now (a failed save keeps it here to try again).
    if (ok) clear(true);
  };

  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label={bill ? "Change the bill" : "New bill"}>
        <h2 className={styles.sheetTitle}>{bill ? `${bill.appRef ?? "Bill"}: change` : "New bill"}</h2>
        <span className={styles.label}>Supplier</span>
        {chosen ? (
          <div className={sp.chosen}>
            <b>{chosen.name}</b>
            {!paid && (
              <button type="button" onClick={() => setVendor("")} disabled={saving}>
                Change
              </button>
            )}
          </div>
        ) : (
          <>
            <input className={styles.input} value={find} onChange={(e) => setFind(e.target.value)} placeholder="Type the supplier's name" aria-label="Find the supplier" autoFocus />
            <div className={styles.chips}>
              {matches.map((r) => (
                <button key={r.vendor.id} type="button" className={styles.chip} onClick={() => setVendor(r.vendor.id)}>
                  {r.vendor.name}
                </button>
              ))}
            </div>
          </>
        )}
        <div className={sp.grid2}>
          <label className={styles.label}>
            Date of the bill
            <input className={styles.input} type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} disabled={saving} />
          </label>
          <label className={styles.label}>
            To be paid by
            <input className={styles.input} type="date" value={due} min={date} onChange={(e) => setDue(e.target.value)} disabled={saving} />
          </label>
        </div>
        <div className={styles.chips}>
          {[7, 14, 30].map((n) => (
            <button key={n} type="button" className={due === addDays(date, n) ? styles.chipOn : styles.chip} onClick={() => setDue(addDays(date, n))} disabled={saving}>
              In {n} days
            </button>
          ))}
        </div>
        <label className={styles.label} htmlFor="bill-amount">
          Amount (GH₵)
        </label>
        <input id="bill-amount" className={styles.input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" disabled={saving} />
        <label className={styles.label} htmlFor="bill-what">
          What it&rsquo;s for
        </label>
        <input id="bill-what" className={styles.input} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={160} placeholder="e.g. 3 tons of 16mm steel" disabled={saving} />
        <label className={styles.label} htmlFor="bill-ref">
          Their bill or invoice number (optional)
        </label>
        <input id="bill-ref" className={styles.input} value={ref} onChange={(e) => setRef(e.target.value)} maxLength={40} disabled={saving} />
        {data.areas.length > 0 && (
          <>
            <span className={styles.label}>Floor or stage (optional)</span>
            <div className={styles.chips}>
              {data.areas.map((a) => (
                <button key={a} type="button" className={floor === a ? styles.chipOn : styles.chip} aria-pressed={floor === a} onClick={() => setFloor(floor === a ? "" : a)} disabled={saving}>
                  {a}
                </button>
              ))}
            </div>
          </>
        )}
        {data.classes.length > 0 && (
          <>
            <label className={styles.label} htmlFor="bill-class">
              Cost type (QuickBooks class, optional)
            </label>
            <select id="bill-class" className={styles.input} value={cls} onChange={(e) => setCls(e.target.value)} disabled={saving}>
              <option value="">None</option>
              {data.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </>
        )}
        <PhotoField idBase="bill" slot={slot} onPick={start} onClear={() => clear()} label={bill?.photoUrl ? "A new photo of the bill (optional)" : "Photo of the bill (optional)"} />
        {error && (
          <p className={styles.sheetError} role="alert">
            {error}
          </p>
        )}
        {bill && !paid && (
          <button
            type="button"
            className={armed ? `${sp.delete} ${styles.dangerArmed}` : sp.delete}
            onClick={() => (armed ? void run({ action: "deletebill", id: bill.id }, "Bill deleted") : setArmed(true))}
            disabled={saving}
          >
            {armed ? "Tap again to delete this bill" : "Delete this bill"}
          </button>
        )}
        <div className={styles.sheetButtons}>
          <button
            type="button"
            className={styles.sheetCancel}
            onClick={() => {
              clear();
              onClose();
            }}
            disabled={saving}
          >
            Cancel
          </button>
          <button type="button" className={styles.sheetSave} onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : bill ? "Save" : "Save the bill"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SupplierSheet({ onClose, onSaved }: { onClose: () => void; onSaved: (next: SuppliersPage, vendor: QboVendor) => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (!name.trim()) return setError("Type the supplier's name.");
    setSaving(true);
    setError("");
    try {
      const next = await send<SuppliersPage & { vendor: QboVendor }>("/api/suppliers", "POST", { action: "supplier", name: name.trim(), phone: phone.trim() });
      onSaved(next, next.vendor);
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };
  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label="New supplier">
        <h2 className={styles.sheetTitle}>New supplier</h2>
        <p className={styles.sheetNote}>It goes into QuickBooks too, so both lists match.</p>
        <label className={styles.label} htmlFor="sup-name">
          Name
        </label>
        <input id="sup-name" className={styles.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="e.g. Sethi Bros Steel" disabled={saving} />
        <label className={styles.label} htmlFor="sup-phone">
          Phone (optional)
        </label>
        <input id="sup-phone" className={styles.input} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} disabled={saving} />
        {error && (
          <p className={styles.sheetError} role="alert">
            {error}
          </p>
        )}
        <div className={styles.sheetButtons}>
          <button type="button" className={styles.sheetCancel} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className={styles.sheetSave} onClick={() => void save()} disabled={saving}>
            {saving ? "Adding…" : "Add the supplier"}
          </button>
        </div>
      </div>
    </div>
  );
}
