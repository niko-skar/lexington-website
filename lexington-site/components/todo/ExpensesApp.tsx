"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isInflow, money, todayISO, type Expense } from "@/lib/expenses/shared";
import type { StoreItem } from "@/lib/store/shared";
import { photoAt, type TodoMe } from "@/lib/todo/shared";
import { AccessSheet } from "./AccessSheet";
import { send, startPolling, when } from "./api";
import { ExpenseBook, receiptDownload } from "./ExpenseBook";
import { ExpenseForm } from "./ExpenseForm";
import site from "./Site.module.css";
import { SiteHeader, SiteMenu } from "./SiteChrome";
import styles from "./Todo.module.css";

// The expense log (the office only): the entry form, then the totals and the list. The page holds
// the entries; the form keeps its own state so typing stays quick on a phone.

type ToastData = { text: string; tone?: "error" };
type ExpensesData = { expenses: Expense[]; items: StoreItem[] };
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
            Each &ldquo;Credit Alert&rdquo; text from the bank then goes in by itself as money in from Leo, and on to QuickBooks. Your phone buzzes so you can change one
            that wasn&rsquo;t from Leo. Only those texts are passed on, nothing else.
          </p>
          <ol className={site.bankSteps}>
            <li>
              Tap <b>Copy the link</b> below.
            </li>
            <li>
              Open the <b>Shortcuts</b> app, tap <b>Automation</b>, then <b>+</b>.
            </li>
            <li>
              Pick <b>Message</b>. In <b>Message Contains</b> type <b>Credit Alert</b>. Pick <b>Run Immediately</b>, then <b>Next</b>.
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
  startedOffline: boolean;
  /** The page came with this part's data just now (it's the part the app opened on). */
  fresh: boolean;
}) {
  const [expenses, setExpenses] = useState(initial?.expenses ?? []);
  const [items, setItems] = useState(initial?.items ?? []);
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
      const items = (JSON.parse(y) as { items: StoreItem[] }).items;
      const sig = x + JSON.stringify(items);
      if (sig === lastServer.current || startedAt < localAt.current) return;
      lastServer.current = sig;
      setExpenses((JSON.parse(x) as { expenses: Expense[] }).expenses);
      setItems(items);
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
    setEditing(x);
    setJustSaved(false);
    setFormKey((k) => k + 1);
    document.getElementById("exp-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const onCancel = useCallback(() => {
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
    (expense: Expense, wasEdit: boolean) => {
      localAt.current = Date.now();
      setExpenses((list) => sortExpenses([expense, ...list.filter((x) => x.id !== expense.id)]));
      setEditing(null);
      setJustSaved(true);
      setFormKey((k) => k + 1);
      const stockNote = expense.toStore && expense.qty ? ` · ${expense.qty} into the store` : "";
      showToast({ text: wasEdit ? `Changes saved · ${expense.ref ?? ""}` : `${isInflow(expense) ? "Money in saved" : "Expense saved"} · ${expense.ref ?? ""} · ${money(expense.amount)}${stockNote}` });
      // The store's stock may have moved (a purchase into the store room, or one changed).
      if (expense.toStore || wasEdit) void refresh();
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
      <SiteHeader title="Expenses" sub={`Spent this month ${money(month.out)}${month.inn ? ` · In ${money(month.inn)}` : ""}`} onMenu={() => setMenuOpen(true)} />

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
            <ExpenseForm
              key={`${editing?.id ?? "new"}-${formKey}`}
              editing={editing}
              expenses={expenses}
              items={items}
              onSaved={onSaved}
              onDeleted={onDeleted}
              onCancel={onCancel}
              onBusy={onBusy}
              onOpenReceipt={onOpenReceipt}
              focusAmount={justSaved}
            />
            <ExpenseBook expenses={expenses} editingId={editing?.id ?? null} onEdit={onEdit} onOpenReceipt={onOpenReceipt} />
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
        </div>
      )}
    </>
  );
}
