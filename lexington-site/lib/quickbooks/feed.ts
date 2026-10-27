import "server-only";
import { createHash, randomBytes } from "node:crypto";

import { FIELDS } from "@/lib/expenses/server";
import { CATEGORIES, METHODS, receiptFileName, todayISO, vatParts, type Expense } from "@/lib/expenses/shared";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { EXPENSE_PREFIX, QBO_FEED_ID, QBO_GONE_PREFIX } from "@/lib/site/ids";

import { fetchCompany, qboApi, QboError } from "./client";
import { loadConnection, writeLog, type QboConnection } from "./store";

// Site expenses into QuickBooks (Niko, 27 Oct 2026: "automate the expenses going into the site app
// and getting entered into quickbooks"). Each Site or Event entry in /todo/expenses becomes one QuickBooks
// transaction: an expense becomes an Expense (Purchase) paid from the account chosen for how it was
// paid, booked to the chosen cost account; money in becomes a Deposit into that account from the
// account its rule names (money from Leo = his shareholder loan, the only loan the company has).
// The receipt photo goes with it. Event entries are the company's marketing events (Niko, 27 Oct 2026)
// and go too, booked to their own account; House / Niko entries never go: they're not the company's.
//
// Like the Google Sheet copy (lib/expenses/sheet.ts), the app stays the record: an entry goes when
// it's saved, again when it changes, and the cron catches up anything missed. It is OFF until Niko
// switches it on, and only entries dated on or after the start date go (the older ones are already
// in the books or are being sorted by hand). It never deletes anything in QuickBooks: an entry
// deleted in the app after it went is listed on the QuickBooks page to remove there by hand.

export type Method = (typeof METHODS)[number];
export type Category = (typeof CATEGORIES)[number];

export interface InflowRule {
  /** Money in whose "From" contains this (any case) goes to `account`. */
  match: string;
  account: string;
}

export interface FeedSettings {
  enabled: boolean;
  /** YYYY-MM-DD: nothing dated earlier is sent. */
  startDate: string | null;
  /** The QuickBooks bank / cash account for each "Paid by". */
  payFrom: Record<Method, string | null>;
  /** The cost account every Site expense is booked to (the building's work in progress). */
  expenseAccount: string | null;
  /** The account every Event expense is booked to (the marketing events). */
  eventAccount: string | null;
  /** The QuickBooks class for Material / Service / Other (optional). */
  classFor: Record<Category, string | null>;
  /** The QuickBooks location for every entry (optional). */
  location: string | null;
  inflowRules: InflowRule[];
  /** The company these account ids belong to. */
  realmId: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

const emptyMethods = (): Record<Method, string | null> => Object.fromEntries(METHODS.map((m) => [m, null])) as Record<Method, string | null>;
const emptyCategories = (): Record<Category, string | null> =>
  Object.fromEntries(CATEGORIES.map((c) => [c, null])) as Record<Category, string | null>;

// Stored field names can't have spaces ("Bank transfer"), so each "Paid by" is kept under a plain key.
const methodKey = (m: Method) => m.toLowerCase().replace(/\s+/g, "_");

export async function loadFeedSettings(): Promise<FeedSettings> {
  const doc = await getBuyersClient().getDocument<Partial<Omit<FeedSettings, "payFrom">> & { payFrom?: Record<string, string | null> }>(QBO_FEED_ID);
  return {
    enabled: doc?.enabled === true,
    startDate: doc?.startDate ?? null,
    payFrom: Object.fromEntries(METHODS.map((m) => [m, doc?.payFrom?.[methodKey(m)] ?? null])) as Record<Method, string | null>,
    expenseAccount: doc?.expenseAccount ?? null,
    eventAccount: doc?.eventAccount ?? null,
    classFor: { ...emptyCategories(), ...(doc?.classFor ?? {}) },
    location: doc?.location ?? null,
    inflowRules: (doc?.inflowRules ?? []).filter((r) => r && r.match && r.account),
    realmId: doc?.realmId ?? null,
    updatedAt: doc?.updatedAt ?? null,
    updatedBy: doc?.updatedBy ?? null,
  };
}

export async function saveFeedSettings(settings: Omit<FeedSettings, "updatedAt">): Promise<void> {
  const client = getBuyersClient();
  await client.createIfNotExists({ _id: QBO_FEED_ID, _type: "qboFeedSettings" });
  await client
    .patch(QBO_FEED_ID)
    .set({
      ...settings,
      payFrom: Object.fromEntries(METHODS.map((m) => [methodKey(m), settings.payFrom[m] ?? null])),
      inflowRules: settings.inflowRules.map((r) => ({ _key: randomBytes(4).toString("hex"), ...r })),
      updatedAt: new Date().toISOString(),
    })
    .commit();
}

/* ---------- the company's lists (for the settings and to check them) ---------- */

export interface QboAccount {
  id: string;
  name: string;
  type: string;
}
export interface QboNamed {
  id: string;
  name: string;
}
export interface QboLists {
  accounts: QboAccount[];
  classes: QboNamed[];
  locations: QboNamed[];
}

/** Account types money can be paid from in an Expense (and paid into by a Deposit). */
export const PAY_TYPES = ["Bank", "Credit Card"];

async function query<T>(q: string, entity: string): Promise<T[]> {
  const reply = await qboApi<{ QueryResponse?: Record<string, unknown> }>("query", { query: { query: q } });
  return ((reply.QueryResponse?.[entity] as T[] | undefined) ?? []).slice();
}

export async function qboLists(): Promise<QboLists> {
  const [accounts, classes, locations] = await Promise.all([
    query<{ Id: string; FullyQualifiedName?: string; Name: string; AccountType: string }>(
      "select Id, Name, FullyQualifiedName, AccountType from Account where Active = true maxresults 1000",
      "Account"
    ),
    // Classes and locations are optional in QuickBooks: a company without them just has none.
    query<{ Id: string; FullyQualifiedName?: string; Name: string }>("select Id, Name, FullyQualifiedName from Class where Active = true maxresults 1000", "Class").catch(
      () => []
    ),
    query<{ Id: string; FullyQualifiedName?: string; Name: string }>(
      "select Id, Name, FullyQualifiedName from Department where Active = true maxresults 1000",
      "Department"
    ).catch(() => []),
  ]);
  const byName = (a: QboNamed, b: QboNamed) => a.name.localeCompare(b.name);
  return {
    accounts: accounts.map((a) => ({ id: a.Id, name: a.FullyQualifiedName || a.Name, type: a.AccountType })).sort(byName),
    classes: classes.map((c) => ({ id: c.Id, name: c.FullyQualifiedName || c.Name })).sort(byName),
    locations: locations.map((l) => ({ id: l.Id, name: l.FullyQualifiedName || l.Name })).sort(byName),
  };
}

/** First guesses for an empty form, from the names in The Lexington's books (nothing is saved). */
export function suggestSettings(lists: QboLists): Pick<FeedSettings, "payFrom" | "expenseAccount" | "eventAccount" | "inflowRules"> {
  const find = (test: (name: string) => boolean, types?: string[]) =>
    lists.accounts.find((a) => test(a.name.toLowerCase()) && (!types || types.includes(a.type)))?.id ?? null;
  const cash = find((n) => n.endsWith("cash on hand"), PAY_TYPES);
  const leo = find((n) => n.includes("shareholder loan") && n.includes("leo"));
  return {
    payFrom: { ...emptyMethods(), Cash: cash, MoMo: cash },
    expenseAccount: find((n) => n.includes("construction work in progress")),
    eventAccount: find((n) => /advertis|marketing|promotion/.test(n), ["Expense", "Other Expense"]),
    inflowRules: leo ? [{ match: "Leo", account: leo }] : [],
  };
}

/* ---------- one entry -> one QuickBooks transaction ---------- */

/** Site and Event entries are the company's; House and Niko entries aren't. */
export const forCompany = (x: Pick<Expense, "forWho">) => x.forWho === "Site" || x.forWho === "Event";

type TxnType = "Purchase" | "Deposit";

interface FeedState {
  hash?: string;
  txnType?: TxnType;
  txnId?: string;
  realmId?: string;
  receiptId?: string | null;
  attachableId?: string | null;
  syncedAt?: string;
  error?: string | null;
}

type FeedDoc = Expense & { qbo?: FeedState };

export type Plan =
  | { send: false; reason: string; /** Shown on the QuickBooks page: Niko has to choose something. */ needsYou: boolean }
  | { send: true; type: TxnType; hash: string; vendor: string | null; build: (vendorId: string | null) => Record<string, unknown>; summary: string };

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const amountText = (n: number) => (Number(n) || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** What decides the transaction: when any of it changes the transaction is updated. */
function contentHash(x: FeedDoc): string {
  return createHash("sha1")
    .update(
      JSON.stringify([x.kind, x.forWho, x.date, x.amount, x.vat, x.vatRate, x.supplier, x.description, x.floor, x.method, x.category, x.material, x.qty, x.ref, x.receiptId ?? null])
    )
    .digest("hex");
}

function alreadySent(x: FeedDoc, conn: QboConnection): boolean {
  return !!x.qbo?.txnId && x.qbo.realmId === conn.realmId;
}

export function planFor(x: FeedDoc, s: FeedSettings, lists: Pick<QboLists, "accounts">, conn: QboConnection): Plan {
  if (!forCompany(x)) return { send: false, reason: `For ${x.forWho}, not the company`, needsYou: false };
  // The start date only decides what goes the first time; something already sent keeps following its changes.
  if (!alreadySent(x, conn) && (!s.startDate || x.date < s.startDate)) return { send: false, reason: "Dated before the start date", needsYou: false };

  const method = (x.method ?? "") as Method;
  const payFrom = s.payFrom[method] ?? null;
  const payAccount = lists.accounts.find((a) => a.id === payFrom);
  if (!payAccount) {
    return { send: false, reason: `Choose the QuickBooks account for "${x.method ?? "no method"}"`, needsYou: true };
  }
  const name = (id: string | null) => lists.accounts.find((a) => a.id === id)?.name ?? "?";
  const noTax = conn.country && conn.country !== "US" ? { GlobalTaxCalculation: "NotApplicable" } : {};
  const event = x.forWho === "Event";
  // The location is the building's stage: it isn't one for a marketing event.
  const location = s.location && !event ? { DepartmentRef: { value: s.location } } : {};
  const hash = contentHash(x);
  const ref = x.ref ?? x.id;

  if (x.kind === "inflow") {
    const from = x.supplier.trim().toLowerCase();
    const rule = s.inflowRules.find((r) => from.includes(r.match.trim().toLowerCase()));
    if (!rule || !lists.accounts.some((a) => a.id === rule.account)) {
      return { send: false, reason: `Money in from "${x.supplier || "no name"}": choose where money from them goes`, needsYou: true };
    }
    const note = [`${ref} from the site app`, event ? "marketing event" : "", `money in from ${x.supplier || "?"}`, `by ${x.method ?? "?"}`, x.description, x.createdBy ? `entered by ${x.createdBy}` : ""]
      .filter(Boolean)
      .join(" · ");
    return {
      send: true,
      type: "Deposit",
      hash,
      vendor: null,
      summary: `Deposit into ${payAccount.name}, from ${name(rule.account)}`,
      build: () => ({
        TxnDate: x.date,
        DepositToAccountRef: { value: payAccount.id },
        PrivateNote: clip(note, 4000),
        ...location,
        ...noTax,
        Line: [
          {
            Amount: x.amount,
            DetailType: "DepositLineDetail",
            Description: clip(x.description || `Money in from ${x.supplier}`, 4000),
            DepositLineDetail: { AccountRef: { value: rule.account } },
          },
        ],
      }),
    };
  }

  const costAccount = event ? s.eventAccount : s.expenseAccount;
  if (!costAccount || !lists.accounts.some((a) => a.id === costAccount)) {
    return { send: false, reason: event ? "Choose the account for marketing events" : "Choose the cost account for site expenses", needsYou: true };
  }
  const category = (x.category ?? "Other") as Category;
  // The classes split the building's costs (material / service / other): marketing has none.
  const classId = event ? null : (s.classFor[category] ?? null);
  const what = [x.material ? `${x.material}${x.qty ? ` x ${x.qty}` : ""}` : "", x.description].filter(Boolean).join(" · ");
  const vat = x.vat ? vatParts(x.amount, x.vatRate) : null;
  const note = [
    `${ref} from the site app`,
    event ? "Marketing event" : "",
    x.category ?? "",
    x.floor ?? "",
    `paid by ${x.method ?? "?"}`,
    vat ? `VAT GHS ${amountText(vat.vat)} included (${x.vatRate}%)` : "",
    x.createdBy ? `entered by ${x.createdBy}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    send: true,
    type: "Purchase",
    hash,
    vendor: x.supplier.trim() || null,
    summary: `Expense from ${payAccount.name}, to ${name(costAccount)}`,
    build: (vendorId) => ({
      TxnDate: x.date,
      PaymentType: payAccount.type === "Credit Card" ? "CreditCard" : "Cash",
      AccountRef: { value: payAccount.id },
      DocNumber: clip(ref, 21),
      PrivateNote: clip(note, 4000),
      ...(vendorId ? { EntityRef: { value: vendorId, type: "Vendor" } } : {}),
      ...location,
      ...noTax,
      Line: [
        {
          Amount: x.amount,
          DetailType: "AccountBasedExpenseLineDetail",
          Description: clip(what || x.supplier || ref, 4000),
          AccountBasedExpenseLineDetail: {
            AccountRef: { value: costAccount },
            ...(classId ? { ClassRef: { value: classId } } : {}),
          },
        },
      ],
    }),
  };
}

/* ---------- talking to QuickBooks ---------- */

const quote = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/** The supplier as a QuickBooks vendor: found by name, or added. */
async function vendorFor(name: string, cache: Map<string, string>): Promise<string> {
  const display = clip(name.replace(/\s+/g, " ").trim(), 100);
  const known = cache.get(display.toLowerCase());
  if (known) return known;
  const found = await query<{ Id: string }>(`select Id from Vendor where DisplayName = '${quote(display)}'`, "Vendor");
  let id = found[0]?.Id;
  if (!id) {
    try {
      id = (await qboApi<{ Vendor: { Id: string } }>("vendor", { method: "POST", body: { DisplayName: display } })).Vendor.Id;
    } catch (error) {
      // The name is already a customer or an employee (or an inactive vendor): add it marked as the supplier.
      if (error instanceof QboError && error.httpStatus === 400 && /duplicate/i.test(error.message)) {
        const other = clip(`${display} (supplier)`, 100);
        const again = await query<{ Id: string }>(`select Id from Vendor where DisplayName = '${quote(other)}'`, "Vendor");
        id = again[0]?.Id ?? (await qboApi<{ Vendor: { Id: string } }>("vendor", { method: "POST", body: { DisplayName: other } })).Vendor.Id;
      } else throw error;
    }
  }
  cache.set(display.toLowerCase(), id);
  return id;
}

/** A transaction this entry already made, should a save of its id have been lost on the way back. */
async function findExisting(type: TxnType, x: FeedDoc): Promise<{ Id: string } | null> {
  const ref = x.ref ?? x.id;
  if (type === "Purchase") {
    const rows = await query<{ Id: string; PrivateNote?: string }>(`select Id, PrivateNote from Purchase where DocNumber = '${quote(clip(ref, 21))}'`, "Purchase");
    return rows.find((r) => (r.PrivateNote ?? "").startsWith(`${ref} from the site app`)) ?? null;
  }
  const rows = await query<{ Id: string; PrivateNote?: string }>(`select Id, PrivateNote from Deposit where TxnDate = '${x.date}'`, "Deposit");
  return rows.find((r) => (r.PrivateNote ?? "").startsWith(`${ref} from the site app`)) ?? null;
}

async function attachReceipt(type: TxnType, txnId: string, x: FeedDoc): Promise<string> {
  if (!x.receiptUrl) throw new QboError("The receipt has no file.");
  const response = await fetch(x.receiptUrl, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new QboError(`The receipt couldn't be fetched (${response.status}).`);
  const bytes = await response.arrayBuffer();
  const type_ = x.receiptType || "image/jpeg";
  const fileName = receiptFileName(x, type_);
  const meta = { AttachableRef: [{ EntityRef: { type, value: txnId } }], FileName: fileName, ContentType: type_ };
  const reply = await qboApi<{ AttachableResponse?: { Attachable?: { Id: string }; Fault?: unknown }[] }>("upload", {
    form: () => {
      const form = new FormData();
      form.append("file_metadata_01", new Blob([JSON.stringify(meta)], { type: "application/json" }), "metadata.json");
      form.append("file_content_01", new Blob([bytes], { type: type_ }), fileName);
      return form;
    },
  });
  const id = reply.AttachableResponse?.[0]?.Attachable?.Id;
  if (!id) throw new QboError("QuickBooks didn't take the receipt photo.");
  return id;
}

/** An entry that went to QuickBooks and is no longer in the app (or no longer the company's): remove it there by hand. */
async function markGone(x: Pick<FeedDoc, "id" | "ref">, state: FeedState, reason: string): Promise<void> {
  if (!state.txnId) return;
  await getBuyersClient().create({
    _id: QBO_GONE_PREFIX + randomBytes(6).toString("hex"),
    _type: "qboGone",
    expenseId: x.id,
    ref: x.ref ?? null,
    txnType: state.txnType ?? null,
    txnId: state.txnId,
    realmId: state.realmId ?? null,
    reason,
    at: new Date().toISOString(),
  });
}

type Outcome = "sent" | "same" | "skipped" | "failed";

async function sendOne(x: FeedDoc, s: FeedSettings, lists: QboLists, conn: QboConnection, vendors: Map<string, string>): Promise<Outcome> {
  const client = getBuyersClient();
  let state: FeedState = x.qbo?.realmId === conn.realmId ? (x.qbo ?? {}) : {};
  const plan = planFor(x, s, lists, conn);

  if (!plan.send) {
    // It went before, and now isn't the company's any more: QuickBooks still has it.
    if (state.txnId && !forCompany(x)) {
      await markGone(x, state, `Changed to "${x.forWho}" in the site app`);
      await client.patch(x.id).unset(["qbo"]).commit();
    }
    return "skipped";
  }
  if (state.hash === plan.hash && state.txnType === plan.type && !state.error) return "same";

  try {
    // Switched between expense and money in: the old transaction is the wrong kind now.
    if (state.txnId && state.txnType !== plan.type) {
      await markGone(x, state, `Changed from ${state.txnType === "Deposit" ? "money in" : "an expense"} in the site app`);
      state = {};
    }
    const vendorId = plan.vendor ? await vendorFor(plan.vendor, vendors) : null;
    const body = plan.build(vendorId);
    const path = plan.type.toLowerCase();

    let txnId: string | null = null;
    if (state.txnId) {
      try {
        const current = await qboApi<Record<TxnType, { Id: string; SyncToken: string }>>(`${path}/${state.txnId}`);
        const updated = await qboApi<Record<TxnType, { Id: string }>>(path, {
          method: "POST",
          body: { ...body, Id: current[plan.type].Id, SyncToken: current[plan.type].SyncToken, sparse: true },
        });
        txnId = updated[plan.type].Id;
      } catch (error) {
        // Deleted in QuickBooks by hand: it goes in again as new.
        if (!(error instanceof QboError && error.httpStatus === 400 && /not found|deleted/i.test(error.message))) throw error;
        state = {};
      }
    }
    if (!txnId) {
      const existing = await findExisting(plan.type, x);
      txnId = existing ? existing.Id : (await qboApi<Record<TxnType, { Id: string }>>(path, { method: "POST", body }))[plan.type].Id;
    }

    // The receipt photo goes with it when it's new (QuickBooks keeps an old one attached: nothing is deleted).
    let attachableId = state.txnId === txnId ? (state.attachableId ?? null) : null;
    if (x.receiptId && (x.receiptId !== state.receiptId || state.txnId !== txnId)) attachableId = await attachReceipt(plan.type, txnId, x);

    await client
      .patch(x.id)
      .set({
        qbo: {
          hash: plan.hash,
          txnType: plan.type,
          txnId,
          realmId: conn.realmId,
          receiptId: x.receiptId ?? null,
          attachableId,
          syncedAt: new Date().toISOString(),
          error: null,
        },
      })
      .commit();
    await writeLog({
      action: "feed",
      ok: true,
      httpStatus: 200,
      intuitTid: null,
      message: `${x.ref ?? x.id}: ${state.txnId ? "updated" : "sent"} as ${plan.type === "Deposit" ? "a deposit" : "an expense"} (QuickBooks ${plan.type} ${txnId}), GHS ${amountText(x.amount)}.`,
    });
    return "sent";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await client
      .patch(x.id)
      .set({ "qbo.error": clip(message, 400), "qbo.failedAt": new Date().toISOString(), "qbo.realmId": conn.realmId })
      .commit()
      .catch(() => {});
    await writeLog({ action: "feed", ok: false, httpStatus: error instanceof QboError ? error.httpStatus : null, intuitTid: error instanceof QboError ? error.intuitTid : null, message: `${x.ref ?? x.id}: ${message}` });
    return "failed";
  }
}

/* ---------- running it ---------- */

const FEED_FIELDS = FIELDS.replace(/}\s*$/, `, "qbo": qbo }`);

async function loadEntries(ids: string[] | null, startDate: string | null): Promise<FeedDoc[]> {
  return getBuyersClient().fetch<FeedDoc[]>(
    ids
      ? `*[_type == "siteExpense" && _id in $ids] ${FEED_FIELDS}`
      : `*[_type == "siteExpense" && string::startsWith(_id, $prefix) && ((date >= $start && coalesce(forWho, "Site") in ["Site", "Event"]) || defined(qbo.txnId))] | order(date asc, createdAt asc)[0...5000] ${FEED_FIELDS}`,
    { ids: ids ?? [], prefix: EXPENSE_PREFIX, start: startDate ?? "9999-12-31" }
  );
}

interface Ready {
  settings: FeedSettings;
  conn: QboConnection;
}

/** The feed can run: switched on, QuickBooks connected, and the settings belong to that company. */
async function ready(): Promise<Ready | null> {
  const settings = await loadFeedSettings();
  if (!settings.enabled) return null;
  const conn = await loadConnection();
  if (!conn || conn.status !== "connected" || settings.realmId !== conn.realmId) return null;
  return { settings, conn };
}

/** One entry, straight after it's saved (runs after the phone already has its answer). */
export async function feedExpense(id: string): Promise<void> {
  try {
    const r = await ready();
    if (!r) return;
    const [x] = await loadEntries([id], null);
    if (!x) return;
    const lists = await qboLists();
    await sendOne(x, r.settings, lists, r.conn, new Map());
  } catch (error) {
    console.error("[quickbooks feed]", id, error instanceof Error ? error.message : error);
  }
}

/** Everything new or changed (oldest first), up to `limit` and about 4 minutes. */
export async function feedPending(limit = 25): Promise<{ sent: number; failed: number; waiting: number }> {
  const r = await ready();
  if (!r) return { sent: 0, failed: 0, waiting: 0 };
  const all = await loadEntries(null, r.settings.startDate);
  const lists = await qboLists();
  const due = all.filter((x) => {
    const plan = planFor(x, r.settings, lists, r.conn);
    const state = x.qbo?.realmId === r.conn.realmId ? (x.qbo ?? {}) : {};
    if (!plan.send) return !!state.txnId && !forCompany(x);
    return state.error || state.hash !== plan.hash || state.txnType !== plan.type;
  });
  const vendors = new Map<string, string>();
  let sent = 0;
  let failed = 0;
  const started = Date.now();
  for (const x of due.slice(0, limit)) {
    if (Date.now() - started > 240_000) break;
    const outcome = await sendOne(x, r.settings, lists, r.conn, vendors);
    if (outcome === "sent") sent++;
    if (outcome === "failed") failed++;
  }
  return { sent, failed, waiting: Math.max(0, due.length - sent) };
}

/**
 * The cron, every 15 minutes: the feed's catch-up, and once a week a small read so the saved
 * QuickBooks login (which lapses after 100 days unused) never runs out while the feed is off.
 */
export async function feedCron(): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = await feedPending(25);
  const conn = await loadConnection();
  if (conn && conn.status === "connected") {
    const last = Date.parse(conn.lastRefreshAt ?? conn.connectedAt);
    if (Date.now() - last > 7 * 24 * 3600 * 1000) {
      try {
        await fetchCompany();
        result.keptAlive = true;
      } catch {
        result.keptAlive = false;
      }
    }
  }
  return result;
}

/* ---------- for the QuickBooks page ---------- */

export interface FeedRow {
  id: string;
  ref: string | null;
  date: string;
  supplier: string;
  amount: number;
  kind: Expense["kind"];
  /** Where it goes (or why it can't go yet). */
  line: string;
}

export interface GoneRow {
  id: string;
  ref: string | null;
  txnType: string | null;
  txnId: string;
  reason: string;
  at: string;
}

export interface FeedStatus {
  settings: FeedSettings;
  sent: number;
  waiting: FeedRow[];
  needsYou: FeedRow[];
  failed: (FeedRow & { error: string })[];
  gone: GoneRow[];
  lastSentAt: string | null;
}

export async function feedStatus(lists: QboLists, conn: QboConnection): Promise<FeedStatus> {
  const settings = await loadFeedSettings();
  const [all, gone] = await Promise.all([
    loadEntries(null, settings.startDate ?? todayISO()),
    getBuyersClient().fetch<GoneRow[]>(
      `*[_type == "qboGone" && string::startsWith(_id, $prefix)] | order(at asc){ "id": _id, ref, txnType, txnId, reason, at }`,
      { prefix: QBO_GONE_PREFIX }
    ),
  ]);
  // Before the first save the page previews from today.
  const s = { ...settings, startDate: settings.startDate ?? todayISO() };
  const row = (x: FeedDoc, line: string): FeedRow => ({ id: x.id, ref: x.ref, date: x.date, supplier: x.supplier, amount: x.amount, kind: x.kind, line });
  const out: FeedStatus = { settings, sent: 0, waiting: [], needsYou: [], failed: [], gone, lastSentAt: null };
  for (const x of all) {
    const state = x.qbo?.realmId === conn.realmId ? (x.qbo ?? {}) : {};
    const plan = planFor(x, s, lists, conn);
    if (state.syncedAt && (!out.lastSentAt || state.syncedAt > out.lastSentAt)) out.lastSentAt = state.syncedAt;
    if (!plan.send) {
      if (plan.needsYou) out.needsYou.push(row(x, plan.reason));
      continue;
    }
    if (state.error) out.failed.push({ ...row(x, plan.summary), error: state.error });
    else if (state.hash === plan.hash && state.txnType === plan.type) out.sent++;
    else out.waiting.push(row(x, plan.summary));
  }
  return out;
}

/** The "Done" button on an entry removed by hand in QuickBooks. */
export async function clearGone(id: string): Promise<void> {
  if (!id.startsWith(QBO_GONE_PREFIX)) return;
  await getBuyersClient().delete(id);
}
