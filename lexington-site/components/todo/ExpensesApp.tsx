"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { debitGuess, debitWords, isInflow, money, shopOf, todayISO, type BankDebit, type Expense } from "@/lib/expenses/shared";
import type { BookLists } from "@/lib/quickbooks/books";
import type { OpenArrival } from "@/lib/store/deliveries";
import type { StoreItem } from "@/lib/store/shared";
import { photoAt, type TodoMe } from "@/lib/todo/shared";
import type { OpenBill } from "@/lib/suppliers/shared";
import { AccessSheet } from "./AccessSheet";
import { send, startPolling, when } from "./api";
import { BankDebits } from "./BankDebits";
import { ExpenseBook, receiptDownload } from "./ExpenseBook";
import { ExpenseForm, niceDate, type ExpensePrefill } from "./ExpenseForm";
import site from "./Site.module.css";
import { SiteHeader, SiteMenu } from "./SiteChrome";
import { SteelCard } from "./SteelCard";
import styles from "./Todo.module.css";

// The expense log (the office only): the entry form, then the totals and the list. The page holds
// the entries; the form keeps its own state so typing stays quick on a phone.

type ToastData = { text: string; tone?: "error"; action?: { label: string; run: () => void } };

/** The form into view: on a phone it's above the list; on a laptop it sits beside it, so only its column goes back to the top. */
function showForm() {
  const side = document.getElementById("exp-side");
  if (side && getComputedStyle(side).position === "sticky") side.scrollTo({ top: 0, behavior: "smooth" });
  else document.getElementById("exp-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
}
type ExpensesData = { expenses: Expense[]; items: StoreItem[]; arrivals?: OpenArrival[]; pending?: BankDebit[]; books?: BookLists; bills?: OpenBill[]; vendors?: string[] };
type SheetState = { configured: boolean; waiting: number; failed: number; lastSyncedAt: string | null; sheetUrl: string | null };

const sortExpenses = (list: Expense[]) =>
  [...list].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt ?? "").localeCompare(a.createdAt ?? "")));

/** In the ☰ menu: is the Google Sheet set up and up to date? */
function SheetStatus() {
  const [status, setStatus] = useState<SheetState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    fetch("/api/expenses/sheet", { cache: "no-store" })
      .then(async (r) => (r.ok ? setStatus((await r.json()) as SheetState) : setNote("Couldn't check the Google Sheet.")))
      .catch(() => setNote("Couldn't check the Google Sheet: no signal."));
  }, []);

  const sendNow = async () => {
    setBusy(true);
    setNote("");
    try {
      const result = await send<{ sent: number; failed: number; status: SheetState }>("/api/expenses/sheet", "POST");
      setStatus(result.status);
      setNote(result.failed ? `${result.failed} couldn't be sent; it tries again by itself.` : `Sent ${result.sent}.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  if (!status) return <p className={site.sheetLine}>{note || "Google Sheet: checking…"}</p>;
  if (!status.configured) return <p className={site.sheetLine}>Google Sheet: not set up yet.</p>;
  const behind = status.waiting + status.failed;
  return (
    <>
      <p className={site.sheetLine}>
        Google Sheet: {behind === 0 ? "up to date" : `${status.waiting} waiting${status.failed ? `, ${status.failed} not sent yet` : ""}`}
        {status.lastSyncedAt ? ` · last sent ${when(status.lastSyncedAt)}` : ""}.{" "}
        {status.sheetUrl && (
          <a href={status.sheetUrl} target="_blank" rel="noreferrer">
            Open the sheet
          </a>
        )}
      </p>
      {note && <p className={site.sheetLine}>{note}</p>}
      {behind > 0 && (
        <div className={styles.menuList}>
          <button type="button" onClick={() => void sendNow()} disabled={busy}>
            {busy ? "Sending…" : "Send to the sheet now"}
          </button>
        </div>
      )}
    </>
  );
}

/* ---------- in the ☰ menu: the bank's credit texts, passed on by the iPhone ---------- */

type BankLast = { receivedAt: string; result: string; ref: string | null; amount: number | null };
type BankState = { link: string; accounts: string[]; last: BankLast | null };

function bankLine(last: BankLast | null) {
  if (!last) return "not set up yet: nothing has come from your iPhone.";
  const at = when(last.receivedAt);
  const amount = last.amount ? `${money(last.amount)} ` : "";
  if (last.result === "added") return `last one ${at}: ${amount}added as ${last.ref ?? "money in"}.`;
  if (last.result === "matched") return `last one ${at}: ${amount}matched ${last.ref ?? "an entry"} you typed.`;
  if (last.result === "other-account") return `last one ${at}: ${amount}on another account, not added.`;
  if (last.result === "buyer") return `last one ${at}: ${amount}a buyer's payment (${last.ref ?? "receipt"}), not added as Leo's.`;
  if (last.result === "pending") return `last one ${at}: ${amount}out, waiting under From the bank.`;
  if (last.result === "fee") return `last one ${at}: a ${amount}bank fee, filed as ${last.ref ?? "an expense"}.`;
  if (last.result === "not-credit") return `your iPhone reached the app ${at} (not a credit text, so nothing was added).`;
  if (last.result === "unreadable") return `last one ${at} couldn't be read: see Alerts.`;
  return `last one ${at} couldn't be added: see Alerts.`;
}

function BankTexts() {
  const [state, setState] = useState<BankState | null>(null);
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    fetch("/api/expenses/bank-text", { cache: "no-store" })
      .then(async (r) => (r.ok ? setState((await r.json()) as BankState) : setNote("Couldn't check the bank texts.")))
      .catch(() => setNote("Couldn't check the bank texts: no signal."));
  }, []);

  const copy = async () => {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(state.link);
      setNote("Link copied. Paste it into the automation (step 5).");
    } catch {
      setNote("Couldn't copy it: press and hold the link to copy it.");
    }
  };

  const renew = async () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    setBusy(true);
    setNote("");
    try {
      setState(await send<BankState>("/api/expenses/bank-text", "POST", { action: "new-link" }));
      setNote("New link made: the old one no longer works. Put this one in the automation.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  if (!state) return <p className={site.sheetLine}>{note || "Bank texts: checking…"}</p>;
  const tail = state.accounts[0]?.replace(/^.*x/, "");
  return (
    <>
      <p className={site.sheetLine}>
        Bank texts{tail ? ` (account ending ${tail})` : ""}: {bankLine(state.last)}
      </p>
      <div className={styles.menuList}>
        <button type="button" onClick={() => setOpen(!open)}>
          {open ? "Hide the iPhone steps" : "Set up bank texts on this iPhone"}
        </button>
      </div>
      {open && (
        <>
          <p className={site.sheetLine}>
            Each text from the bank then goes in by itself: money in as from Leo (and on to QuickBooks), money out under &ldquo;From the bank&rdquo; for you to
            complete, and the bank&rsquo;s fees filed by themselves. Only the bank&rsquo;s texts are passed on, nothing else. Set up already with &ldquo;Credit
            Alert&rdquo;? Open that automation and change it to <b>Acct Num</b>, so the debit texts come too.
          </p>
          <ol className={site.bankSteps}>
            <li>
              Tap <b>Copy the link</b> below.
            </li>
            <li>
              Open the <b>Shortcuts</b> app, tap <b>Automation</b>, then <b>+</b>.
            </li>
            <li>
              Pick <b>Message</b>. In <b>Message Contains</b> type <b>Acct Num</b> (it&rsquo;s in every credit and debit text). Pick <b>Run Immediately</b>, then <b>Next</b>.
            </li>
            <li>
              Tap <b>New Blank Automation</b>, <b>Add Action</b>, and pick <b>Get Contents of URL</b>.
            </li>
            <li>
              Tap <b>URL</b> and paste the link.
            </li>
            <li>
              Tap the <b>›</b> arrow. <b>Method</b>: POST. <b>Request Body</b>: JSON. <b>Add new field</b> → <b>Text</b>: key <b>text</b>, and for the value pick{" "}
              <b>Shortcut Input</b>.
            </li>
            <li>
              Tap <b>Done</b>. The next credit text shows up here by itself.
            </li>
          </ol>
          <p className={site.bankLink}>{state.link}</p>
          <div className={styles.menuList}>
            <button type="button" onClick={() => void copy()}>
              Copy the link
            </button>
            <button type="button" className={armed ? styles.dangerArmed : undefined} onClick={() => void renew()} disabled={busy}>
              {busy ? "Making a new link…" : armed ? "Tap again: the old link stops working" : "Make a new link"}
            </button>
          </div>
        </>
      )}
      {note && <p className={site.sheetLine}>{note}</p>}
    </>
  );
}

export function ExpensesApp({
  me,
  active,
  initial,
  openEntry,
  openDebit,
  onSteel,
  payBill,
  payOrder,
  tabs,
  startedOffline,
  fresh,
}: {
  me: TodoMe;
  /** On screen: only then does it keep itself fresh. */
  active: boolean;
  /** Null when the app opened on another part and the expenses haven't arrived yet. */
  initial: ExpensesData | null;
  /** Opened from a bank text's phone alert: that entry opens in the form. */
  openEntry?: string;
  /** Opened from a bank debit's phone alert: the form starts from that debit. */
  openDebit?: string;
  /** Opens the steel page (the steel card's button). */
  onSteel: () => void;
  /** "Pay" on a supplier's bill (lib/suppliers): the form starts filled in for it. "at" makes the same one count again. */
  payBill?: { payment: { billId: string; supplier: string; amount: number; description: string; bill: OpenBill; receipt?: { id: string; url: string; type: string } | null }; at: number } | null;
  /** "Pay it now" on a purchase order (lib/orders): the form starts filled in for it. */
  payOrder?: { prefill: ExpensePrefill; at: number } | null;
  /** Finance's tabs, under the header. */
  tabs?: React.ReactNode;
  startedOffline: boolean;
  /** The page came with this part's data just now (it's the part the app opened on). */
  fresh: boolean;
}) {
  const [expenses, setExpenses] = useState(initial?.expenses ?? []);
  const [items, setItems] = useState(initial?.items ?? []);
  // Goods checked in at the store and not paid for yet (the form asks "Already in the store?").
  const [arrivals, setArrivals] = useState<OpenArrival[]>(initial?.arrivals ?? []);
  // The bank's debits waiting to be completed, and the one in the form now.
  const [pending, setPending] = useState<BankDebit[]>(initial?.pending ?? []);
  // The QuickBooks classes and locations for the form (kept in the website, read again now and then).
  const [books, setBooks] = useState<BookLists | null>(initial?.books ?? null);
  // The suppliers' bills still to pay, and QuickBooks' supplier names (lib/suppliers).
  const [bills, setBills] = useState<OpenBill[]>(initial?.bills ?? []);
  const [vendors, setVendors] = useState<string[]>(initial?.vendors ?? []);
  const [prefill, setPrefill] = useState<ExpensePrefill | null>(null);
  const prefillRef = useRef<ExpensePrefill | null>(null);
  const pendingCount = useRef(pending.length);
  useEffect(() => {
    prefillRef.current = prefill;
    pendingCount.current = pending.length;
  });
  const [loaded, setLoaded] = useState(initial !== null);
  const [offline, setOffline] = useState(startedOffline);
  const [signedOut, setSignedOut] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [lightbox, setLightbox] = useState<{ url: string; download: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [justSaved, setJustSaved] = useState(false);
  const saving = useRef(false);
  const localAt = useRef(0);
  const inFlight = useRef(false);
  const lastServer = useRef("");
  const lastLoadedAt = useRef(0);
  const skipFirst = useRef(fresh);
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
      const [x, y] = await Promise.all([a.text(), b.text()]);
      lastLoadedAt.current = Date.now();
      setLoaded(true);
      setOffline(false);
      // Unchanged (the store's history may move; only its items matter here): leave the screen alone.
      const store = JSON.parse(y) as { items: StoreItem[]; arrivals?: OpenArrival[] };
      const items = store.items;
      const sig = x + JSON.stringify(items) + JSON.stringify(store.arrivals ?? []);
      if (sig === lastServer.current || startedAt < localAt.current) return;
      lastServer.current = sig;
      const got = JSON.parse(x) as { expenses: Expense[]; pending?: BankDebit[]; books?: BookLists; bills?: OpenBill[]; vendors?: string[] };
      setExpenses(got.expenses);
      setPending(got.pending ?? []);
      if (got.books) setBooks(got.books);
      if (got.bills) setBills(got.bills);
      if (got.vendors) setVendors(got.vendors);
      setItems(items);
      setArrivals(store.arrivals ?? []);
    } catch {
      setOffline(true);
    } finally {
      inFlight.current = false;
    }
  }, []);

  // Only the office uses this page: a check every 30 seconds while it's in use is plenty.
  useEffect(() => {
    if (!active) return;
    // Opened on this part: what the page came with is fresh. Otherwise look again at once.
    if (skipFirst.current) skipFirst.current = false;
    else if (Date.now() - lastLoadedAt.current > 4_000) void refresh();
    return startPolling(refresh, 30_000, 120_000);
  }, [active, refresh]);

  /* ---------- the form's doings ---------- */

  const onBusy = useCallback((busy: boolean) => {
    saving.current = busy;
  }, []);

  const onEdit = useCallback((x: Expense) => {
    if (saving.current) return; // the save on its way would clear the form again when it lands
    setPrefill(null);
    setEditing(x);
    setJustSaved(false);
    setFormKey((k) => k + 1);
    showForm();
  }, []);

  const onCancel = useCallback(() => {
    setPrefill(null);
    setEditing(null);
    setJustSaved(false);
    setFormKey((k) => k + 1);
  }, []);

  // Opened from a bank text's phone alert: the entry opens in the form, ready to change, and the
  // address drops the alert's part so a reload doesn't do it again.
  const openedEntry = useRef(false);
  useEffect(() => {
    if (!openEntry || openedEntry.current || !loaded) return;
    const timer = setTimeout(() => {
      openedEntry.current = true;
      const url = new URL(window.location.href);
      url.searchParams.delete("open");
      url.searchParams.delete("alert");
      window.history.replaceState(null, "", url.pathname + url.search);
      const x = expenses.find((e) => e.id === openEntry);
      if (x) onEdit(x);
      else if (!offline) showToast({ text: "That entry isn't there any more." });
    }, 200);
    return () => clearTimeout(timer);
  }, [openEntry, loaded, expenses, offline, onEdit, showToast]);

  const onSaved = useCallback(
    (expense: Expense, wasEdit: boolean, extras: Expense[] = []) => {
      localAt.current = Date.now();
      const made = new Set([expense.id, ...extras.map((e) => e.id)]);
      setExpenses((list) => sortExpenses([expense, ...extras, ...list.filter((x) => !made.has(x.id))]));
      // Made from a bank debit: it's done. (One typed for the same day and amount is matched on the server.)
      const done = prefillRef.current?.debitId;
      if (done) setPending((list) => list.filter((d) => d.id !== done));
      setPrefill(null);
      setEditing(null);
      setJustSaved(true);
      setFormKey((k) => k + 1);
      const stockNote = expense.toStore && expense.qty ? ` · ${expense.qty} into the store` : "";
      const extraNote = extras.length ? ` + ${extras.map((e) => `${e.description} ${money(e.amount)}`).join(", ")}` : "";
      showToast({ text: wasEdit ? `Changes saved · ${expense.ref ?? ""}` : `${isInflow(expense) ? "Money in saved" : "Expense saved"} · ${expense.ref ?? ""} · ${money(expense.amount)}${extraNote}${stockNote}` });
      // The store's stock may have moved (a purchase into the store room, or one changed), a bank debit matched it, or a
      // supplier's bill has less left to pay.
      if (expense.toStore || wasEdit || expense.billId || pendingCount.current > 0) void refresh();
    },
    [refresh, showToast]
  );

  const onDeleted = useCallback(
    (expense: Expense) => {
      localAt.current = Date.now();
      setExpenses((list) => list.filter((x) => x.id !== expense.id));
      setEditing(null);
      setJustSaved(false);
      setFormKey((k) => k + 1);
      showToast({ text: `Deleted ${expense.ref ?? ""}` });
      if (expense.toStore) void refresh();
    },
    [refresh, showToast]
  );

  /* ---------- the bank's debits ---------- */

  const onComplete = useCallback(
    (d: BankDebit) => {
      if (saving.current) return;
      const guess = debitGuess(d, [...new Set(expenses.filter((e) => !isInflow(e)).map((e) => e.supplier.trim()).filter(Boolean))]);
      const place = d.where ? shopOf(d.where).place : "";
      setEditing(null);
      setPrefill({
        debitId: d.id,
        date: d.date,
        amount: d.amount,
        method: guess.method,
        supplier: guess.supplier,
        description: guess.description,
        note: `From the bank's text: ${money(d.amount)}, ${niceDate(d.date)}${d.time ? ` ${d.time}` : ""}, ${debitWords(d)}${place ? ` (${place})` : ""}. Say who it's for and what it was, add the receipt, and save.`,
      });
      setJustSaved(false);
      setFormKey((k) => k + 1);
      setTimeout(showForm, 50);
    },
    [expenses]
  );

  // "Pay" on a supplier's bill: a new expense to that supplier for what's left, paying that bill.
  useEffect(() => {
    if (!payBill) return;
    const timer = setTimeout(() => {
      if (saving.current) return;
      const { payment } = payBill;
      // The bill may be newer than the bills this part read: add it, or the form can't keep it.
      setBills((bs) => (bs.some((b) => b.id === payment.bill.id) ? bs : [...bs, payment.bill]));
      setEditing(null);
      setPrefill({
        billId: payment.billId,
        receipt: payment.receipt ?? null,
        date: todayISO(),
        amount: payment.amount,
        method: null,
        supplier: payment.supplier,
        description: payment.description,
        note: "Paying a supplier's bill: say how it was paid, add the receipt, and save. In QuickBooks it goes in as that bill's payment.",
      });
      setJustSaved(false);
      setFormKey((k) => k + 1);
      showForm();
    }, 0);
    return () => clearTimeout(timer);
  }, [payBill]);

  // "Pay it now" on a purchase order: a new expense for what's left of it, with its materials, floor and cost type.
  useEffect(() => {
    if (!payOrder) return;
    const timer = setTimeout(() => {
      if (saving.current) return;
      setEditing(null);
      setPrefill(payOrder.prefill);
      setJustSaved(false);
      setFormKey((k) => k + 1);
      showForm();
    }, 0);
    return () => clearTimeout(timer);
  }, [payOrder]);

  const onDismiss = useCallback(
    async (d: BankDebit) => {
      try {
        await send("/api/expenses/bank-debit", "POST", { id: d.id, action: "dismiss" });
        localAt.current = Date.now();
        setPending((list) => list.filter((x) => x.id !== d.id));
        if (prefillRef.current?.debitId === d.id) onCancel();
        showToast({
          text: `${money(d.amount)} put aside: not an expense`,
          action: {
            label: "Undo",
            run: () =>
              void send("/api/expenses/bank-debit", "POST", { id: d.id, action: "restore" }).then(
                () => {
                  localAt.current = 0;
                  void refresh();
                },
                (e) => showToast({ text: e instanceof Error ? e.message : "That didn't work.", tone: "error" })
              ),
          },
        });
      } catch (e) {
        showToast({ text: e instanceof Error ? e.message : "That didn't work.", tone: "error" });
      }
    },
    [onCancel, refresh, showToast]
  );

  // Opened from a bank debit's phone alert: the form starts from it, and the address drops the alert's part.
  const openedDebit = useRef(false);
  useEffect(() => {
    if (!openDebit || openedDebit.current || !loaded) return;
    const timer = setTimeout(() => {
      openedDebit.current = true;
      const url = new URL(window.location.href);
      url.searchParams.delete("debit");
      url.searchParams.delete("alert");
      window.history.replaceState(null, "", url.pathname + url.search);
      const d = pending.find((x) => x.id === openDebit);
      if (d) onComplete(d);
      else if (!offline) showToast({ text: "That bank text is done already." });
    }, 200);
    return () => clearTimeout(timer);
  }, [openDebit, loaded, pending, offline, onComplete, showToast]);

  // A photo opens big (with "Save the photo" under its traceable name); a PDF opens in the browser.
  const onOpenReceipt = useCallback((x: Expense) => {
    if (!x.receiptUrl) return;
    if (x.receiptType === "application/pdf") window.open(x.receiptUrl, "_blank", "noopener");
    else setLightbox({ url: x.receiptUrl, download: receiptDownload(x) });
  }, []);

  /* ---------- the header ---------- */

  const month = useMemo(() => {
    const thisMonth = todayISO().slice(0, 7);
    let out = 0;
    let inn = 0;
    for (const x of expenses) {
      if (!x.date.startsWith(thisMonth)) continue;
      if (isInflow(x)) inn += x.amount;
      else out += x.amount;
    }
    return { out, inn };
  }, [expenses]);

  return (
    <>
      <SiteHeader
        eyebrow={tabs ? "Finance" : undefined}
        title="Expenses"
        sub={`Spent this month ${money(month.out)}${month.inn ? ` · In ${money(month.inn)}` : ""}`}
        onMenu={() => setMenuOpen(true)}
      >
        {tabs}
      </SiteHeader>

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
        {!loaded ? (
          <p className={styles.loading}>Loading the expenses…</p>
        ) : (
          <>
            <div className={site.deskSplit}>
            <div id="exp-side" className={site.deskSide}>
            <BankDebits pending={pending} completing={prefill?.debitId ?? null} onComplete={onComplete} onDismiss={(d) => void onDismiss(d)} />
            <ExpenseForm
              key={`${editing?.id ?? prefill?.debitId ?? prefill?.billId ?? prefill?.poId ?? "new"}-${formKey}`}
              editing={editing}
              prefill={prefill}
              books={books}
              bills={bills}
              vendors={vendors}
              expenses={expenses}
              items={items}
              arrivals={arrivals}
              onSaved={onSaved}
              onDeleted={onDeleted}
              onCancel={onCancel}
              onBusy={onBusy}
              onOpenReceipt={onOpenReceipt}
              focusAmount={justSaved}
            />
            </div>
            <div>
            <SteelCard expenses={expenses} items={items} onOpen={onSteel} />
            <ExpenseBook expenses={expenses} editingId={editing?.id ?? null} onEdit={onEdit} onOpenReceipt={onOpenReceipt} />
            </div>
            </div>
          </>
        )}
      </main>

      {menuOpen && (
        <SiteMenu me={me} onClose={() => setMenuOpen(false)} onRefresh={() => void refresh()} onLogins={() => setAccessOpen(true)}>
          <SheetStatus />
          <BankTexts />
        </SiteMenu>
      )}
      {accessOpen && <AccessSheet onClose={() => setAccessOpen(false)} />}

      {lightbox && (
        <div className={styles.lightbox} onClick={() => setLightbox(null)} role="dialog" aria-label="Receipt">
          {/* eslint-disable-next-line @next/next/no-img-element -- full-size view from the image store */}
          <img src={photoAt(lightbox.url, 2000)} alt="" />
          <div className={styles.lightboxBar}>
            <a href={lightbox.download} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
              Save the photo
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
          {toast.action && (
            <button
              type="button"
              onClick={() => {
                const run = toast.action?.run;
                setToast(null);
                run?.();
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </>
  );
}
