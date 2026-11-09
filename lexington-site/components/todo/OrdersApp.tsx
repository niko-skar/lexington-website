"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { money } from "@/lib/expenses/shared";
import {
  lineTotal,
  linesText,
  MAX_ORDER_LINES,
  monthEnd,
  ORDER_CATEGORIES,
  orderDescription,
  orderStage,
  orderText,
  qtyWords,
  type OrderCategory,
  type OrderLine,
  type OrdersPage,
  type OrderView,
  type ShopLine,
} from "@/lib/orders/shared";
import type { TodoMe } from "@/lib/todo/shared";
import { AccessSheet } from "./AccessSheet";
import { errorText, send, startPolling } from "./api";
import { niceDate, type ExpensePrefill } from "./ExpenseForm";
import fin from "./Finance.module.css";
import { SiteHeader, SiteMenu } from "./SiteChrome";
import sp from "./Suppliers.module.css";
import type { BillPrefill } from "./SuppliersApp";
import styles from "./Todo.module.css";

// Purchase orders (lib/orders/shared.ts says what and why): what's to be bought, from whom, for how much and by when.
// "Mark as ordered" when it's placed; "Make it a bill" when it's bought on credit (the supplier's page, its bill form
// filled in); "Pay it now" when it's paid there and then (the expense form filled in). What's left of an order is what
// the cash flow counts on the day it's needed.

type ToastData = { text: string; tone?: "error" };
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const neededWords = (o: OrderView, today: string) =>
  (o.done ? `needed ${niceDate(o.neededBy)}` : o.late ? `was needed ${niceDate(o.neededBy)}` : o.neededBy === today ? "needed today" : `needed by ${niceDate(o.neededBy)}`) +
  (o.payBy && !o.done ? ` · paid ${o.payBy < today ? "since" : "by"} ${niceDate(o.payBy)}` : "");

/** What "Make it a bill" hands the bill form: what's left of the order, its words, floor and cost type. */
export function billFromOrder(o: OrderView, areas: readonly string[]): BillPrefill | null {
  if (!o.vendorId) return null;
  return {
    poId: o.id,
    vendorId: o.vendorId,
    // Bought on credit: the bill is due when the order said it's paid.
    due: o.payBy,
    amount: o.left,
    description: orderDescription(o, 160),
    floor: o.floor && o.floor !== "Whole building" && areas.includes(o.floor) ? o.floor : null,
    costClass: o.costClass,
    note: `From order ${o.number}: type their bill number and when it's to be paid. The order is then billed; QuickBooks gets the bill.`,
  };
}

/** What "Pay it now" hands the expense form: what's left of the order, its materials (into the store room), floor and cost type. */
export function paymentFromOrder(o: OrderView, today: string): ExpensePrefill {
  return {
    poId: o.id,
    date: today,
    amount: o.left,
    method: null,
    supplier: o.supplier,
    description: orderDescription(o, 300),
    note: `Paying order ${o.number}: say how it was paid, add the receipt, and save.`,
    category: o.category,
    lines: o.category === "Material" ? o.lines.slice(0, 20).map((l) => ({ material: l.name.slice(0, 60), qty: l.qty ?? 1, unit: l.unit || "pcs" })) : undefined,
    floor: o.floor,
    costClass: o.costClass,
  };
}

export function OrdersApp({
  me,
  active,
  initial,
  startedOffline,
  fresh,
  tabs,
  ask,
  onBill,
  onPay,
}: {
  me: TodoMe;
  active: boolean;
  initial: OrdersPage | null;
  startedOffline: boolean;
  fresh: boolean;
  /** Finance's tabs, under the header. */
  tabs?: React.ReactNode;
  /** Asked from elsewhere (the cash flow): that order open. */
  ask?: { orderId: string; at: number } | null;
  /** "Make it a bill": the supplier's page, the bill form filled in. */
  onBill: (prefill: BillPrefill) => void;
  /** "Pay it now": the expense form filled in. */
  onPay: (prefill: ExpensePrefill) => void;
}) {
  const [data, setData] = useState<OrdersPage | null>(initial);
  const [offline, setOffline] = useState(startedOffline);
  const [signedOut, setSignedOut] = useState(false);
  const [sheet, setSheet] = useState<{ order: OrderView | null } | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
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
      const response = await fetch("/api/orders", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        setSignedOut(true);
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      const next = (await response.json()) as OrdersPage;
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

  // Opened from the cash flow or a concrete pour: that order's sheet. The orders it has may be from before the order was
  // made (loaded when the app opened): then it waits for them to be loaded again. Once per ask (they refresh meanwhile).
  const askDone = useRef<number | null>(null);
  useEffect(() => {
    if (!ask || !data || askDone.current === ask.at) return;
    const o = data.orders.find((x) => x.id === ask.orderId);
    if (!o && lastLoadedAt.current < ask.at) {
      void refresh();
      return;
    }
    const timer = setTimeout(() => {
      // Marked done only when it opens (a re-run before then clears this timer and starts its own).
      askDone.current = ask.at;
      if (o) setSheet({ order: o });
      else showToast({ text: "That order isn't there any more." });
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask, data]);

  const put = useCallback((next: OrdersPage) => {
    localAt.current = Date.now();
    setData(next);
  }, []);

  const move = useCallback(
    async (o: OrderView, action: string, text: string) => {
      setBusy(o.id);
      try {
        put(await send<OrdersPage>("/api/orders", "POST", { action, id: o.id }));
        showToast({ text });
        return true;
      } catch (e) {
        showToast({ text: errorText(e), tone: "error" });
        return false;
      } finally {
        setBusy(null);
      }
    },
    [put, showToast]
  );

  const today = data?.today ?? new Date().toISOString().slice(0, 10);
  const copy = async (o: OrderView) => {
    try {
      await navigator.clipboard.writeText(orderText(o, today));
      showToast({ text: `${o.number} copied: paste it in WhatsApp to ${o.supplier || "the supplier"}` });
    } catch {
      showToast({ text: "Couldn't copy it on this phone.", tone: "error" });
    }
  };

  const open = data?.orders.filter((o) => !o.done) ?? [];
  const toOrder = open.filter((o) => o.status === "planned");
  const ordered = open.filter((o) => o.status === "ordered");
  const done = data?.orders.filter((o) => o.done) ?? [];
  const leftTotal = open.reduce((n, o) => n + o.left, 0);

  const card = (o: OrderView) => (
    <OrderCard
      key={o.id}
      order={o}
      today={today}
      busy={busy === o.id}
      onOpen={() => setSheet({ order: o })}
      onOrdered={() => void move(o, "ordered", `${o.number} is ordered`)}
      onBill={() => {
        const bill = data ? billFromOrder(o, data.areas) : null;
        if (bill) onBill(bill);
        else setSheet({ order: o });
      }}
      onPay={() => onPay(paymentFromOrder(o, today))}
      onCopy={() => void copy(o)}
    />
  );

  return (
    <>
      <SiteHeader
        eyebrow={tabs ? "Finance" : undefined}
        title="Orders"
        sub={
          !data
            ? "Loading…"
            : open.length
              ? [toOrder.length ? `${toOrder.length} to order` : "", ordered.length ? `${ordered.length} ordered` : "", `${money(leftTotal)} still to buy`].filter(Boolean).join(" · ")
              : "Nothing on order"
        }
        onMenu={() => setMenuOpen(true)}
      >
        {tabs}
      </SiteHeader>
      {signedOut && (
        <div className={styles.banner} role="alert">
          You&rsquo;ve been signed out. <a href="/todo/orders">Sign in again</a>
        </div>
      )}
      {offline && !signedOut && (
        <div className={styles.banner} role="status">
          No signal: showing the orders as they were. Changes need a signal.
        </div>
      )}

      <main className={styles.main}>
        {!data ? (
          <p className={styles.loading}>Loading the orders…</p>
        ) : (
          <>
            <div className={sp.addBar}>
              <button type="button" className={styles.addPhoto} onClick={() => setSheet({ order: null })}>
                + New order
              </button>
            </div>
            {open.length === 0 && (
              <p className={styles.empty}>
                Nothing on order. Make an order for what&rsquo;s to be bought (from the shopping list or typed): from whom, how much, and when it&rsquo;s needed. It
                shows on the cash flow on that day, and becomes a bill or an expense when it&rsquo;s bought.
              </p>
            )}
            {toOrder.length > 0 && (
              <section className={styles.group} aria-label="To order">
                <h2 className={styles.groupTitle}>
                  To order <span>{money(toOrder.reduce((n, o) => n + o.left, 0))}</span>
                </h2>
                <div className={fin.orders}>{toOrder.map(card)}</div>
              </section>
            )}
            {ordered.length > 0 && (
              <section className={styles.group} aria-label="Ordered">
                <h2 className={styles.groupTitle}>
                  Ordered, still to bill or pay <span>{money(ordered.reduce((n, o) => n + o.left, 0))}</span>
                </h2>
                <div className={fin.orders}>{ordered.map(card)}</div>
              </section>
            )}
            {done.length > 0 && (
              <>
                <button type="button" className={styles.linkButton} onClick={() => setShowDone(!showDone)}>
                  {showDone ? "Hide" : "Show"} {done.length} done {done.length === 1 ? "order" : "orders"} (the last month)
                </button>
                {showDone && <div className={fin.orders}>{done.map(card)}</div>}
              </>
            )}
            <p className={fin.small}>Orders stay in the app: QuickBooks gets the bill or the payment an order becomes.</p>
          </>
        )}
      </main>

      {sheet && data && (
        <OrderSheet
          data={data}
          order={sheet.order}
          onClose={() => setSheet(null)}
          onSaved={(next, text) => {
            put(next);
            setSheet(null);
            showToast({ text });
          }}
          onMove={async (o, action, text) => {
            if (await move(o, action, text)) setSheet(null);
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

function OrderCard({
  order: o,
  today,
  busy,
  onOpen,
  onOrdered,
  onBill,
  onPay,
  onCopy,
}: {
  order: OrderView;
  today: string;
  busy: boolean;
  onOpen: () => void;
  onOrdered: () => void;
  onBill: () => void;
  onPay: () => void;
  onCopy: () => void;
}) {
  const what = linesText(o.lines) || o.note || "Purchase order";
  return (
    <article className={o.late ? `${fin.order} ${fin.orderLate}` : fin.order} aria-label={`Order ${o.number}`}>
      <button type="button" className={fin.orderMain} onClick={onOpen}>
        <span>
          <small>
            {o.number} · {o.supplier || "supplier not chosen yet"}
          </small>
          <b>{what.length > 90 ? `${what.slice(0, 89)}…` : what}</b>
          <small className={o.late ? fin.late : undefined}>
            {neededWords(o, today)} · {orderStage(o)}
          </small>
        </span>
        <span className={fin.amounts}>
          <b>{money(o.done ? o.amount : o.left)}</b>
          <small>{o.done ? "in all" : o.billed || o.paid ? `left of ${money(o.amount)}` : o.unpriced ? `+ ${o.unpriced} not priced` : "to buy"}</small>
        </span>
      </button>
      {!o.done && (
        <div className={fin.buttons}>
          {o.status === "planned" && o.vendorId && (
            <button type="button" className={fin.primary} onClick={onOrdered} disabled={busy}>
              {busy ? "Saving…" : "Mark as ordered"}
            </button>
          )}
          {o.status === "planned" && !o.vendorId && (
            <button type="button" onClick={onOpen}>
              Pick the supplier
            </button>
          )}
          {o.vendorId && (
            <button type="button" className={o.status === "ordered" ? fin.primary : undefined} onClick={onBill} disabled={busy}>
              Make it a bill
            </button>
          )}
          <button type="button" onClick={onPay} disabled={busy}>
            Pay it now
          </button>
          <button type="button" onClick={onCopy}>
            Copy for WhatsApp
          </button>
        </div>
      )}
    </article>
  );
}

/* ---------- making or changing an order ---------- */

type LineDraft = { key: string; name: string; qty: string; unit: string; price: string; buyId: string | null; itemId: string | null; toolId: string | null };
const emptyLine = (key: string): LineDraft => ({ key, name: "", qty: "", unit: "", price: "", buyId: null, itemId: null, toolId: null });
const numberOf = (s: string) => {
  const n = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const draftOf = (l: OrderLine): LineDraft => ({
  key: l.key,
  name: l.name,
  qty: l.qty === null ? "" : String(l.qty),
  unit: l.unit,
  price: l.price === null ? "" : String(l.price),
  buyId: l.buyId,
  itemId: l.itemId,
  toolId: l.toolId,
});

function OrderSheet({
  data,
  order,
  onClose,
  onSaved,
  onMove,
}: {
  data: OrdersPage;
  order: OrderView | null;
  onClose: () => void;
  onSaved: (next: OrdersPage, text: string) => void;
  onMove: (o: OrderView, action: string, text: string) => Promise<void>;
}) {
  const today = data.today;
  const closed = !!order && (order.status === "closed" || order.status === "cancelled");
  const used = !!order && (order.billed > 0 || order.paid > 0);
  // New lines' keys (made in the taps that add them), never one the order has already.
  const nextKey = useRef(0);
  const newKey = (taken: readonly LineDraft[]) => {
    let key = `n${nextKey.current++}`;
    while (taken.some((l) => l.key === key)) key = `n${nextKey.current++}`;
    return key;
  };
  const [vendor, setVendor] = useState(order?.vendorId ?? "");
  const [find, setFind] = useState("");
  const [category, setCategory] = useState<OrderCategory>(order?.category ?? "Material");
  const [lines, setLines] = useState<LineDraft[]>(() => (order ? order.lines.map(draftOf) : [emptyLine("first")]));
  const [estimate, setEstimate] = useState(order?.estimate ? String(order.estimate) : "");
  const [neededBy, setNeededBy] = useState(order?.neededBy ?? addDays(today, 7));
  // When it's paid: "" = when it comes.
  const [payBy, setPayBy] = useState(order?.payBy ?? "");
  const [floor, setFloor] = useState(order?.floor ?? "");
  const [cls, setCls] = useState(order?.costClass?.id ?? "");
  const [note, setNote] = useState(order?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const [error, setError] = useState("");
  const chosen = data.suppliers.find((s) => s.id === vendor) ?? null;
  const q = find.trim().toLowerCase();
  const matches = q ? data.suppliers.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 8) : [];
  // The shopping list's lines not on this order yet.
  const onSheet = new Set(lines.map((l) => l.buyId ?? l.itemId).filter(Boolean));
  const shopping = data.shopping.filter((s) => !onSheet.has(s.buyId ?? s.itemId));
  const priced = lines.filter((l) => numberOf(l.price) !== null);
  const total = priced.length ? Math.round(priced.reduce((n, l) => n + lineTotal({ qty: numberOf(l.qty), price: numberOf(l.price) }), 0) * 100) / 100 : (numberOf(estimate) ?? 0);

  const change = (key: string, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addShop = (s: ShopLine) =>
    setLines((ls) => [
      // An empty first line makes way for it.
      ...ls.filter((l) => l.name.trim() || l.qty || l.price),
      { key: newKey(ls), name: s.name, qty: s.qty === null ? "" : String(s.qty), unit: s.unit, price: "", buyId: s.buyId, itemId: s.itemId, toolId: s.toolId },
    ]);

  const save = async () => {
    const filled = lines.filter((l) => l.name.trim() || l.qty.trim() || l.price.trim());
    if (!filled.length) return setError("Add what's to be bought.");
    if (filled.some((l) => !l.name.trim())) return setError("Say what each line is, or take the empty line off.");
    if (!(total > 0)) return setError("Put a price on the lines, or say about how much it all comes to (the cash flow needs it).");
    setSaving(true);
    setError("");
    const c = data.classes.find((x) => x.id === cls);
    try {
      const next = await send<OrdersPage & { orderId: string }>("/api/orders", "POST", {
        action: "save",
        ...(order ? { id: order.id } : {}),
        vendorId: chosen?.id ?? null,
        category,
        lines: filled.map((l) => ({
          key: l.key,
          name: l.name.trim(),
          qty: l.qty.trim() || null,
          unit: l.unit.trim(),
          price: l.price.trim() || null,
          buyId: l.buyId,
          itemId: l.itemId,
          toolId: l.toolId,
        })),
        estimate: priced.length ? null : estimate.trim() || null,
        neededBy,
        payBy: payBy || null,
        note: note.trim(),
        floor: floor || null,
        costClass: c ? { id: c.id, name: c.name } : null,
      });
      const made = next.orders.find((o) => o.id === next.orderId);
      onSaved(next, order ? `${order.number} saved` : `${made?.number ?? "Order"} made · ${money(total)}, needed ${niceDate(neededBy)}`);
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };

  const act = async (action: string, text: string) => {
    if (!order) return;
    if (armed !== action) {
      setArmed(action);
      return;
    }
    setSaving(true);
    await onMove(order, action, text);
    setSaving(false);
  };

  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label={order ? `Order ${order.number}` : "New order"}>
        <h2 className={styles.sheetTitle}>{order ? `${order.number}${closed ? ` (${order.status})` : ""}` : "New order"}</h2>
        {order && <p className={styles.sheetNote}>{orderStage(order)}</p>}

        <span className={styles.label}>Supplier</span>
        {chosen ? (
          <div className={sp.chosen}>
            <b>{chosen.name}</b>
            {!used && !closed && (
              <button type="button" onClick={() => setVendor("")} disabled={saving}>
                Change
              </button>
            )}
          </div>
        ) : (
          <>
            <input
              className={styles.input}
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="Type the supplier's name (or leave it for later)"
              aria-label="Find the supplier"
              disabled={closed}
            />
            <div className={styles.chips}>
              {matches.map((s) => (
                <button key={s.id} type="button" className={styles.chip} onClick={() => setVendor(s.id)}>
                  {s.name}
                </button>
              ))}
            </div>
          </>
        )}

        <span className={styles.label}>What for</span>
        <div className={styles.chips}>
          {ORDER_CATEGORIES.map((c) => (
            <button key={c} type="button" className={category === c ? styles.chipOn : styles.chip} aria-pressed={category === c} onClick={() => setCategory(c)} disabled={saving || closed}>
              {c}
            </button>
          ))}
        </div>

        <span className={styles.label}>What&rsquo;s to be bought</span>
        <div className={fin.lines}>
          {lines.map((l, i) => {
            const lineSum = lineTotal({ qty: numberOf(l.qty), price: numberOf(l.price) });
            return (
              <div key={l.key} className={fin.lineBox}>
                <div className={fin.lineTop}>
                  <input
                    className={styles.input}
                    value={l.name}
                    onChange={(e) => change(l.key, { name: e.target.value })}
                    maxLength={80}
                    placeholder={i === 0 ? "e.g. 16mm steel" : "What"}
                    aria-label={`Line ${i + 1}: what`}
                    disabled={saving || closed}
                  />
                  {lines.length > 1 && !closed && (
                    <button type="button" className={fin.lineRemove} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Take line ${i + 1} off`} disabled={saving}>
                      ✕
                    </button>
                  )}
                </div>
                <div className={fin.lineNums}>
                  <input className={styles.input} inputMode="decimal" value={l.qty} onChange={(e) => change(l.key, { qty: e.target.value })} placeholder="Qty" aria-label={`Line ${i + 1}: how many`} disabled={saving || closed} />
                  <input className={styles.input} value={l.unit} onChange={(e) => change(l.key, { unit: e.target.value })} maxLength={20} placeholder="Unit" aria-label={`Line ${i + 1}: unit`} disabled={saving || closed} />
                  <input
                    className={styles.input}
                    inputMode="decimal"
                    value={l.price}
                    onChange={(e) => change(l.key, { price: e.target.value })}
                    placeholder="GH₵ each"
                    aria-label={`Line ${i + 1}: price each`}
                    disabled={saving || closed}
                  />
                </div>
                {lineSum > 0 && (
                  <p className={fin.lineTotal}>
                    {qtyWords({ qty: numberOf(l.qty), unit: l.unit.trim() }) || "1"} = {money(lineSum)}
                  </p>
                )}
              </div>
            );
          })}
          {lines.length < MAX_ORDER_LINES && !closed && (
            <button type="button" className={fin.addLine} onClick={() => setLines((ls) => [...ls, emptyLine(newKey(ls))])} disabled={saving}>
              + Add an item
            </button>
          )}
        </div>
        {shopping.length > 0 && !closed && (
          <>
            <span className={styles.label}>From the shopping list</span>
            <div className={styles.chips}>
              {shopping.slice(0, 24).map((s) => (
                <button key={s.key} type="button" className={styles.chip} onClick={() => addShop(s)} disabled={saving}>
                  + {s.name}
                  {s.qty !== null ? ` · ${qtyWords(s)}` : ""}
                  {s.urgent ? " (today)" : ""}
                </button>
              ))}
            </div>
          </>
        )}
        {priced.length ? (
          <p className={fin.total}>
            Total <b>{money(total)}</b>
          </p>
        ) : (
          <>
            <label className={styles.label} htmlFor="order-estimate">
              No prices yet: about how much in all? (GH₵, for the cash flow)
            </label>
            <input id="order-estimate" className={styles.input} inputMode="decimal" value={estimate} onChange={(e) => setEstimate(e.target.value)} placeholder="e.g. 18000" disabled={saving || closed} />
          </>
        )}

        <label className={styles.label} htmlFor="order-needed">
          When it&rsquo;s needed
        </label>
        <input id="order-needed" className={styles.input} type="date" value={neededBy} onChange={(e) => e.target.value && setNeededBy(e.target.value)} disabled={saving || closed} />
        <div className={styles.chips}>
          {(
            [
              ["Today", 0],
              ["In a week", 7],
              ["In 2 weeks", 14],
              ["In a month", 30],
            ] as const
          ).map(([label, n]) => (
            <button key={label} type="button" className={neededBy === addDays(today, n) ? styles.chipOn : styles.chip} onClick={() => setNeededBy(addDays(today, n))} disabled={saving || closed}>
              {label}
            </button>
          ))}
        </div>

        <label className={styles.label} htmlFor="order-pay">
          When it&rsquo;s paid
        </label>
        <div className={styles.chips}>
          {(
            [
              ["When it comes", ""],
              ["End of the month", monthEnd(neededBy)],
              ["30 days after", addDays(neededBy, 30)],
            ] as const
          ).map(([label, day]) => (
            <button key={label} type="button" className={payBy === day ? styles.chipOn : styles.chip} aria-pressed={payBy === day} onClick={() => setPayBy(day)} disabled={saving || closed}>
              {label}
            </button>
          ))}
        </div>
        <input id="order-pay" className={styles.input} type="date" value={payBy || neededBy} onChange={(e) => setPayBy(e.target.value && e.target.value !== neededBy ? e.target.value : "")} disabled={saving || closed} />
        <p className={fin.small}>The cash flow counts it {payBy ? `on ${niceDate(payBy)}` : "the day it comes"}; a bill made from it is due then.</p>

        {data.areas.length > 0 && (
          <>
            <span className={styles.label}>Floor or stage (optional)</span>
            <div className={styles.chips}>
              {data.areas.map((a) => (
                <button key={a} type="button" className={floor === a ? styles.chipOn : styles.chip} aria-pressed={floor === a} onClick={() => setFloor(floor === a ? "" : a)} disabled={saving || closed}>
                  {a}
                </button>
              ))}
            </div>
          </>
        )}
        {data.classes.length > 0 && (
          <>
            <label className={styles.label} htmlFor="order-class">
              Cost type (QuickBooks class, optional)
            </label>
            <select id="order-class" className={styles.input} value={cls} onChange={(e) => setCls(e.target.value)} disabled={saving || closed}>
              <option value="">None</option>
              {data.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </>
        )}
        <label className={styles.label} htmlFor="order-note">
          Note for the supplier (optional)
        </label>
        <input id="order-note" className={styles.input} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. Deliver to the site gate" disabled={saving || closed} />

        {order && (order.bills.length > 0 || order.payments.length > 0) && (
          <>
            <span className={styles.label}>What it became</span>
            <ul className={fin.history}>
              {order.bills.map((b) => (
                <li key={b.id}>
                  {b.appRef ?? "Bill"} · {niceDate(b.date)} · <b>{money(b.amount)}</b> on credit
                </li>
              ))}
              {order.payments.map((x) => (
                <li key={x.id}>
                  {x.ref ?? "Expense"} · {niceDate(x.date)} · <b>{money(x.amount)}</b> paid{x.method ? ` (${x.method})` : ""}
                </li>
              ))}
            </ul>
          </>
        )}

        {error && (
          <p className={styles.sheetError} role="alert">
            {error}
          </p>
        )}

        {order && (
          <div className={fin.buttons} style={{ marginTop: 12 }}>
            {order.status === "ordered" && !used && (
              <button type="button" className={armed === "unordered" ? styles.dangerArmed : undefined} onClick={() => void act("unordered", `${order.number} is back to "to order"`)} disabled={saving}>
                {armed === "unordered" ? "Tap again: not ordered" : "Not ordered after all"}
              </button>
            )}
            {!closed && used && (
              <button type="button" className={armed === "close" ? styles.dangerArmed : undefined} onClick={() => void act("close", `${order.number} closed: the rest isn't needed`)} disabled={saving}>
                {armed === "close" ? "Tap again to close it" : "Close it: the rest isn't needed"}
              </button>
            )}
            {!closed && !used && (
              <button type="button" className={armed === "cancel" ? styles.dangerArmed : undefined} onClick={() => void act("cancel", `${order.number} cancelled`)} disabled={saving}>
                {armed === "cancel" ? "Tap again to cancel it" : "Cancel the order"}
              </button>
            )}
            {closed && (
              <button type="button" className={fin.primary} onClick={() => void act("reopen", `${order.number} is open again`)} disabled={saving}>
                {armed === "reopen" ? "Tap again to open it again" : "Open it again"}
              </button>
            )}
          </div>
        )}

        <div className={styles.sheetButtons}>
          <button type="button" className={styles.sheetCancel} onClick={onClose} disabled={saving}>
            {closed ? "Close" : "Cancel"}
          </button>
          {!closed && (
            <button type="button" className={styles.sheetSave} onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : order ? "Save" : "Save the order"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
