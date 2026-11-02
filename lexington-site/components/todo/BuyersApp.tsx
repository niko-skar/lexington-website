"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { BUYER_METHODS, MAX_NOTE, paymentText, usd, type BuyerMethod, type BuyerRow, type BuyersData } from "@/lib/buyers/shared";
import type { TodoMe } from "@/lib/todo/shared";
import { AccessSheet } from "./AccessSheet";
import b from "./Buyers.module.css";
import { errorText, send, startPolling } from "./api";
import { niceDate } from "./ExpenseForm";
import { SiteHeader, SiteMenu } from "./SiteChrome";
import styles from "./Todo.module.css";

// The buyers and their payments (lib/buyers/shared.ts says what and why): each buyer with what they've paid of
// their price, and "Log a payment": saved on their account, numbered, and the receipt emailed to them at once;
// their buyer page shows it as soon as it's saved.

type ToastData = { text: string; tone?: "error" };
const todayGhana = () => new Date().toISOString().slice(0, 10);
const methodLabel = (m: string | null) => BUYER_METHODS.find((x) => x.value === m)?.label ?? (m ? m : "—");

export function BuyersApp({ me, active, initial, startedOffline, fresh }: { me: TodoMe; active: boolean; initial: BuyersData | null; startedOffline: boolean; fresh: boolean }) {
  const [data, setData] = useState<BuyersData>(initial ?? { buyers: [], lastRate: null });
  const [loaded, setLoaded] = useState(initial !== null);
  const [offline, setOffline] = useState(startedOffline);
  const [signedOut, setSignedOut] = useState(false);
  const [paying, setPaying] = useState<BuyerRow | null>(null);
  const [open, setOpen] = useState<string | null>(null);
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
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const startedAt = Date.now();
    try {
      const response = await fetch("/api/buyers", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        setSignedOut(true);
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      const next = (await response.json()) as BuyersData;
      lastLoadedAt.current = Date.now();
      setLoaded(true);
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

  const totals = data.buyers.reduce((t, x) => ({ paid: t.paid + x.paidUSD, price: t.price + x.priceUSD }), { paid: 0, price: 0 });

  return (
    <>
      <SiteHeader
        title="Buyers"
        sub={data.buyers.length ? `${data.buyers.length} ${data.buyers.length === 1 ? "buyer" : "buyers"} · ${usd(totals.paid)} paid of ${usd(totals.price)}` : "No buyers yet"}
        onMenu={() => setMenuOpen(true)}
      />
      {signedOut && (
        <div className={styles.banner} role="alert">
          You&rsquo;ve been signed out. <a href="/todo/buyers">Sign in again</a>
        </div>
      )}
      {offline && !signedOut && (
        <div className={styles.banner} role="status">
          No signal: showing the buyers as they were. Logging a payment needs a signal.
        </div>
      )}

      <main className={styles.main}>
        {!loaded ? (
          <p className={styles.loading}>Loading the buyers…</p>
        ) : data.buyers.length === 0 ? (
          <p className={styles.empty}>No buyer accounts yet. A buyer&rsquo;s account is made in Studio; they then show here.</p>
        ) : (
          <div className={b.list}>
          {data.buyers.map((x) => {
            const share = x.priceUSD > 0 ? Math.min(100, Math.round((x.paidUSD / x.priceUSD) * 100)) : 0;
            const last = x.payments[0];
            return (
              <article key={x.id} className={b.card}>
                <div className={b.top}>
                  <span className={b.name}>{x.name}</span>
                  {x.unit && <span className={b.unit}>{x.unit}</span>}
                </div>
                <div className={b.bar} aria-hidden="true">
                  <span style={{ width: `${share}%` }} />
                </div>
                <p className={b.line}>
                  <b>{usd(x.paidUSD)}</b> paid of {usd(x.priceUSD)} · <b>{usd(x.balanceUSD)}</b> to come
                </p>
                {x.missingRate > 0 && <p className={b.warn}>{x.missingRate} cedi payment{x.missingRate === 1 ? " has" : "s have"} no rate, so {x.missingRate === 1 ? "it isn't" : "they aren't"} counted in dollars.</p>}
                {last && (
                  <p className={b.line}>
                    Last: {paymentText(last)}
                    {last.date ? ` on ${niceDate(last.date)}` : ""}
                    {last.receipt ? ` · ${last.receipt}` : ""}
                    {last.emailedAt ? " emailed ✓" : last.receipt && !last.noEmail ? " not emailed yet" : ""}
                  </p>
                )}
                <div className={b.buttons}>
                  <button type="button" className={b.pay} onClick={() => setPaying(x)}>
                    Log a payment
                  </button>
                  {x.payments.length > 0 && (
                    <button type="button" className={b.more} onClick={() => setOpen(open === x.id ? null : x.id)} aria-expanded={open === x.id}>
                      {open === x.id ? "Hide payments" : `Payments (${x.payments.length})`}
                    </button>
                  )}
                </div>
                {open === x.id && (
                  <ul className={b.payments}>
                    {x.payments.map((p) => (
                      <li key={p.key}>
                        <span>
                          {p.date ? niceDate(p.date) : "No date"} · <b>{paymentText(p)}</b>
                          {p.currency === "GHS" ? (p.usd !== null ? ` = ${usd(p.usd)}` : " (no rate)") : ""} · {methodLabel(p.method)}
                          {p.note ? ` · ${p.note}` : ""}
                        </span>
                        <span className={b.receipt}>
                          {p.receipt ? (
                            <a href={`/admin/receipts/${x.id}/${p.key}`} target="_blank" rel="noreferrer">
                              {p.receipt}
                            </a>
                          ) : (
                            "No receipt yet"
                          )}
                          {p.receipt && !p.noEmail
                            ? p.emailedAt
                              ? ` · emailed ${niceDate(p.emailedAt.slice(0, 10))}`
                              : p.emailError
                                ? " · email not sent yet (tries again)"
                                : " · email on its way"
                            : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
          </div>
        )}
      </main>

      {paying && (
        <PaymentSheet
          buyer={paying}
          lastRate={data.lastRate}
          onClose={() => setPaying(null)}
          onSaved={(next, receipt, emailed) => {
            localAt.current = Date.now();
            setData(next);
            setPaying(null);
            setOpen(paying.id);
            showToast(
              emailed.ok
                ? { text: `${receipt ?? "The receipt"} emailed to ${paying.name} (${emailed.to}); it's on their buyer page too.` }
                : { text: `${receipt ?? "The receipt"} is made and on their buyer page; the email didn't go yet (${emailed.error}). It tries again in a few minutes.`, tone: "error" }
            );
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

/* ---------- a payment ---------- */

function PaymentSheet({
  buyer,
  lastRate,
  onClose,
  onSaved,
}: {
  buyer: BuyerRow;
  lastRate: number | null;
  onClose: () => void;
  onSaved: (data: BuyersData, receipt: string | null, emailed: { ok: true; to: string } | { ok: false; error: string }) => void;
}) {
  const previous = buyer.payments[0];
  const [currency, setCurrency] = useState<"USD" | "GHS">(previous?.currency ?? "USD");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState(String(buyer.payments.find((p) => p.currency === "GHS" && p.exchangeRate)?.exchangeRate ?? lastRate ?? ""));
  const [date, setDate] = useState(todayGhana());
  const [method, setMethod] = useState<BuyerMethod>((previous?.method as BuyerMethod) ?? "bank-transfer");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const value = Number(amount.replace(/,/g, ""));
  const r = Number(rate.replace(/,/g, ""));
  const inUsd = currency === "USD" ? value : r > 0 ? value / r : null;

  const save = async () => {
    if (!(value > 0)) return setError("Type the amount paid.");
    if (currency === "GHS" && !(r > 1)) return setError("Type the rate used: cedis per US dollar that day.");
    setSaving(true);
    setError("");
    try {
      const result = await send<BuyersData & { receipt: string | null; emailed: { ok: true; to: string } | { ok: false; error: string } }>("/api/buyers", "POST", {
        buyerId: buyer.id,
        amount: value,
        currency,
        exchangeRate: currency === "GHS" ? r : undefined,
        date,
        method,
        note: note.trim(),
      });
      onSaved({ buyers: result.buyers, lastRate: result.lastRate }, result.receipt, result.emailed);
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };

  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label="Log a payment">
        <h2 className={styles.sheetTitle}>Payment from {buyer.name}</h2>
        <p className={styles.sheetNote}>
          {buyer.unit ? `Unit ${buyer.unit} · ` : ""}
          {usd(buyer.balanceUSD)} still to come.
        </p>
        <span className={styles.label}>Paid in</span>
        <div className={styles.chips}>
          {(["USD", "GHS"] as const).map((c) => (
            <button key={c} type="button" className={currency === c ? styles.chipOn : styles.chip} aria-pressed={currency === c} onClick={() => setCurrency(c)} disabled={saving}>
              {c === "USD" ? "US dollars" : "Cedis"}
            </button>
          ))}
        </div>
        <label className={styles.label} htmlFor="bp-amount">
          Amount ({currency === "USD" ? "US$" : "GH₵"})
        </label>
        <input id="bp-amount" className={styles.input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" disabled={saving} />
        {currency === "GHS" && (
          <>
            <label className={styles.label} htmlFor="bp-rate">
              Rate used: GH₵ per US$ that day
            </label>
            <input id="bp-rate" className={styles.input} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 15.5" disabled={saving} />
            {inUsd !== null && value > 0 && <p className={styles.sheetNote}>Counts as {usd(Math.round(inUsd * 100) / 100)} towards the price.</p>}
          </>
        )}
        <label className={styles.label} htmlFor="bp-date">
          Paid on
        </label>
        <input id="bp-date" className={styles.input} type="date" value={date} max={todayGhana()} onChange={(e) => e.target.value && setDate(e.target.value)} disabled={saving} />
        <span className={styles.label}>Paid by</span>
        <div className={styles.chips}>
          {BUYER_METHODS.map((m) => (
            <button key={m.value} type="button" className={method === m.value ? styles.chipOn : styles.chip} aria-pressed={method === m.value} onClick={() => setMethod(m.value)} disabled={saving}>
              {m.label}
            </button>
          ))}
        </div>
        <label className={styles.label} htmlFor="bp-note">
          Note on the receipt (optional)
        </label>
        <input id="bp-note" className={styles.input} value={note} onChange={(e) => setNote(e.target.value)} maxLength={MAX_NOTE} placeholder="e.g. Second instalment" disabled={saving} />
        <p className={styles.sheetNote}>
          Saving puts it on {buyer.name.split(" ")[0]}&rsquo;s buyer page and emails the receipt to <b>{buyer.email}</b> straight away.
        </p>
        {error && <p className={styles.sheetError}>{error}</p>}
        <div className={styles.sheetButtons}>
          <button type="button" className={styles.sheetCancel} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className={styles.sheetSave} onClick={() => void save()} disabled={saving}>
            {saving ? "Saving and emailing…" : "Save and email the receipt"}
          </button>
        </div>
      </div>
    </div>
  );
}
