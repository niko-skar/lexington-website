import "server-only";
import { createHash, randomBytes } from "node:crypto";

import { FIELDS } from "@/lib/expenses/server";
import { CATEGORIES, materialWords, METHODS, receiptFileName, todayISO, vatParts, type Expense } from "@/lib/expenses/shared";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { BILL_PREFIX, EXPENSE_PREFIX, QBO_FEED_ID, QBO_GONE_PREFIX } from "@/lib/site/ids";

import { classNamed, locationForArea, TRADE_CLASS } from "./books";
import { BOOK_LISTS_STALE_MS, cachedBookLists, saveBookLists } from "./booksCache";
import { fetchCompany, qboApi, QboError } from "./client";
import { loadConnection, writeLog, type QboConnection } from "./store";
import { syncHistory } from "./history";
import { refreshVendors } from "./vendors";

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

/**
 * The classes and locations kept in the website for the expense form (lib/quickbooks/booksCache.ts), read again
 * from QuickBooks when they're a few hours old (or now, when `force`). Never throws.
 */
export async function refreshBookLists(force = false): Promise<void> {
  try {
    if (!force) {
      const cached = await cachedBookLists();
      if (cached.fetchedAt && Date.now() - Date.parse(cached.fetchedAt) < BOOK_LISTS_STALE_MS) return;
    }
    const conn = await loadConnection();
    if (!conn || conn.status !== "connected") return;
    await saveBookLists(await qboLists());
  } catch (error) {
    console.error("[quickbooks lists]", error instanceof Error ? error.message : error);
  }
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

type TxnType = "Purchase" | "Deposit" | "BillPayment";

interface FeedState {
  hash?: string;
  /** "Bill" on a supplier's bill (lib/suppliers). */
  txnType?: TxnType | "Bill";
  /** The entry's more photos already attached in QuickBooks (3 Nov 2026). */
  moreAttached?: string[];
  txnId?: string;
  realmId?: string;
  receiptId?: string | null;
  attachableId?: string | null;
  syncedAt?: string;
  error?: string | null;
  /** Set while a run is adding it to QuickBooks, so a second run at the same time doesn't add it twice. */
  sendingAt?: string | null;
}

type FeedDoc = Expense & { qbo?: FeedState; rev?: string };

/** A supplier's bill as the feed needs it, for the payments that pay it (2 Nov 2026, lib/suppliers). */
export interface BillLink {
  vendorId: string;
  txnId: string | null;
  realmId: string | null;
  deleted: boolean;
}
type Lists = Pick<QboLists, "accounts" | "classes" | "locations"> & { bills?: ReadonlyMap<string, BillLink> };

export type Plan =
  | { send: false; reason: string; /** Shown on the QuickBooks page: Niko has to choose something. */ needsYou: boolean }
  | { send: true; type: TxnType; hash: string; vendor: string | null; build: (vendorId: string | null) => Record<string, unknown>; summary: string };

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const amountText = (n: number) => (Number(n) || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** What decides the transaction: when any of it changes the transaction is updated. */
function contentHash(x: FeedDoc): string {
  return createHash("sha1")
    .update(
      JSON.stringify([
        x.kind,
        x.forWho,
        x.date,
        x.amount,
        x.vat,
        x.vatRate,
        x.supplier,
        x.description,
        x.floor,
        x.method,
        x.category,
        x.material,
        x.qty,
        x.ref,
        x.receiptId ?? null,
        x.costClass?.id ?? null,
        x.payday?.lines?.map((l) => [l.id, l.amount, l.group]) ?? null,
        x.billId ?? null,
        // Only an entry that has them: every other entry keeps the check it had (nothing is sent again for nothing).
        ...(x.moreLines?.length ? [x.moreLines.map((l) => [l.material, l.qty])] : []),
        ...(x.moreReceipts?.length ? [x.moreReceipts.map((r) => r.id)] : []),
      ])
    )
    .digest("hex");
}

function alreadySent(x: FeedDoc, conn: QboConnection): boolean {
  return !!x.qbo?.txnId && x.qbo.realmId === conn.realmId;
}

export function planFor(x: FeedDoc, s: FeedSettings, lists: Lists, conn: QboConnection): Plan {
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
  // The location is the building's stage or floor: the entry's floor when the books have it as a location
  // ("Ground floor" -> "Ground Floor", "Foundations"), else the stage set on the QuickBooks page (wages, and
  // entries for the whole building). It isn't one for a marketing event.
  const locationId = event ? null : (locationForArea(x.floor, lists.locations)?.id ?? s.location ?? null);
  const location = locationId ? { DepartmentRef: { value: locationId } } : {};
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

  // A payment of a supplier's bill (lib/suppliers): its Bill Payment, linked to the bill, which holds the cost (so
  // nothing counts twice). It waits until the bill itself is in QuickBooks.
  const bill = x.billId ? lists.bills?.get(x.billId) : undefined;
  if (bill && !bill.deleted && !event) {
    if (!bill.txnId || bill.realmId !== conn.realmId) return { send: false, reason: "Waiting for its bill to go into QuickBooks", needsYou: false };
    const billTxn = bill.txnId;
    const card = payAccount.type === "Credit Card";
    const note = [`${ref} from the site app`, `pays a bill of ${x.supplier || "?"}`, `paid by ${x.method ?? "?"}`, x.description, x.createdBy ? `entered by ${x.createdBy}` : ""]
      .filter(Boolean)
      .join(" · ");
    return {
      send: true,
      type: "BillPayment",
      hash: createHash("sha1").update(`${hash}:${billTxn}`).digest("hex"),
      vendor: null,
      summary: `Bill payment from ${payAccount.name}`,
      build: () => ({
        VendorRef: { value: bill.vendorId },
        TxnDate: x.date,
        PayType: card ? "CreditCard" : "Check",
        ...(card ? { CreditCardPayment: { CCAccountRef: { value: payAccount.id } } } : { CheckPayment: { BankAccountRef: { value: payAccount.id } } }),
        TotalAmt: x.amount,
        DocNumber: clip(ref, 21),
        PrivateNote: clip(note, 4000),
        Line: [{ Amount: x.amount, LinkedTxn: [{ TxnId: billTxn, TxnType: "Bill" }] }],
      }),
    };
  }

  const costAccount = event ? s.eventAccount : s.expenseAccount;
  if (!costAccount || !lists.accounts.some((a) => a.id === costAccount)) {
    return { send: false, reason: event ? "Choose the account for marketing events" : "Choose the cost account for site expenses", needsYou: true };
  }
  const category = (x.category ?? "Other") as Category;
  // The class is the cost type: the one chosen on the entry (found again by its name if it was renamed), else
  // the one set for its kind on the QuickBooks page. Marketing has none.
  const chosen = x.costClass ? (lists.classes.find((c) => c.id === x.costClass?.id) ?? classNamed(x.costClass.name, lists.classes)) : null;
  const classId = event ? null : (chosen?.id ?? s.classFor[category] ?? null);
  // Wages from Payday: a line per payment, each on the class of the worker's trade.
  const lineClass = (group: string) => classNamed(TRADE_CLASS[group] ?? "", lists.classes)?.id ?? classId;
  const paid = x.payday?.lines?.length ? x.payday : null;
  const what = [x.moreLines?.length ? materialWords(x) : x.material ? `${x.material}${x.qty ? ` x ${x.qty}` : ""}` : "", x.description].filter(Boolean).join(" · ");
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
      Line: paid
        ? paid.lines.map((l) => {
            const lc = lineClass(l.group);
            return {
              Amount: l.amount,
              DetailType: "AccountBasedExpenseLineDetail",
              Description: clip(`${l.name}: ${paid.kind === "machines" ? "steel machines" : "wages"}, week from ${paid.week}${l.ref ? ` (${l.ref})` : ""}`, 4000),
              AccountBasedExpenseLineDetail: { AccountRef: { value: costAccount }, ...(lc ? { ClassRef: { value: lc } } : {}) },
            };
          })
        : [
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
  if (type === "Purchase" || type === "BillPayment") {
    const rows = await query<{ Id: string; PrivateNote?: string }>(`select Id, PrivateNote from ${type} where DocNumber = '${quote(clip(ref, 21))}'`, type);
    return rows.find((r) => (r.PrivateNote ?? "").startsWith(`${ref} from the site app`)) ?? null;
  }
  const rows = await query<{ Id: string; PrivateNote?: string }>(`select Id, PrivateNote from Deposit where TxnDate = '${x.date}'`, "Deposit");
  return rows.find((r) => (r.PrivateNote ?? "").startsWith(`${ref} from the site app`)) ?? null;
}

async function attachReceipt(type: TxnType, txnId: string, x: FeedDoc): Promise<string> {
  if (!x.receiptUrl) throw new QboError("The receipt has no file.");
  const type_ = x.receiptType || "image/jpeg";
  return attachFile(type, txnId, x.receiptUrl, type_, receiptFileName(x, type_));
}

/** A file from the image store attached to a transaction in QuickBooks (a receipt, a supplier's bill). */
async function attachFile(type: string, txnId: string, url: string, type_: string, fileName: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new QboError(`The photo couldn't be fetched (${response.status}).`);
  const bytes = await response.arrayBuffer();
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

type QboLine = Record<string, unknown> & { Id?: string; DetailType?: string; Description?: string; LinkedTxn?: unknown[] };
type QboTxn = Record<string, unknown> & { Id: string; SyncToken: string; Line?: QboLine[] };

/**
 * The body that changes a transaction already in QuickBooks to `body` (a sparse update). An
 * Expense's lines are replaced by the ones sent. A Deposit keeps every line it has and adds the ones
 * sent without an Id, sparse or full update alike (a corrected amount went in as a second line,
 * 27 Oct 2026; tried on the practice company), and the API can't remove a deposit line. So the
 * entry's line goes onto the deposit's first line, and any other line it has is set to 0.
 */
function updateBody(type: TxnType, current: QboTxn, body: Record<string, unknown>): Record<string, unknown> {
  const sparse = { ...body, Id: current.Id, SyncToken: current.SyncToken, sparse: true };
  if (type !== "Deposit") return sparse;
  const lines = (current.Line ?? []).filter((l) => l.Id && l.DetailType === "DepositLineDetail" && !l.LinkedTxn?.length);
  if (!lines.length) return sparse;
  const first = lines.reduce((a, b) => (Number(a.Id) <= Number(b.Id) ? a : b));
  const [line] = body.Line as QboLine[];
  const zeroed = lines
    .filter((l) => l.Id !== first.Id)
    .map((l) => ({ Id: l.Id, Amount: 0, DetailType: l.DetailType, Description: l.Description, DepositLineDetail: l.DepositLineDetail }));
  return { ...sparse, Line: [{ ...line, Id: first.Id }, ...zeroed] };
}

const CLAIM_MS = 5 * 60_000;

/**
 * Marks the entry as being added, unless another run already is (two saves seconds apart each start
 * a run). The mark only takes on the entry as last read, so two runs can't both get it.
 */
async function claim(x: FeedDoc, state: FeedState, realmId: string): Promise<boolean> {
  const fresh = (at?: string | null) => !!at && Date.now() - Date.parse(at) < CLAIM_MS;
  if (fresh(state.sendingAt)) return false;
  const client = getBuyersClient();
  let rev = x.rev;
  for (let attempt = 0; attempt < 3 && rev; attempt++) {
    try {
      await client.patch(x.id).ifRevisionId(rev).set({ "qbo.sendingAt": new Date().toISOString(), "qbo.realmId": realmId }).commit();
      return true;
    } catch {
      // Changed since it was read: by another run (leave it to that one), or by something else
      // that writes to the entry, like the Google Sheet copy (try again on the entry as it is now).
      const now = await client.fetch<{ rev: string; txnId?: string; sendingAt?: string; realmId?: string } | null>(
        `*[_id == $id][0]{ "rev": _rev, "txnId": qbo.txnId, "sendingAt": qbo.sendingAt, "realmId": qbo.realmId }`,
        { id: x.id }
      );
      if (!now || (now.realmId === realmId && (now.txnId || fresh(now.sendingAt)))) return false;
      rev = now.rev;
    }
  }
  return false;
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

type Outcome = "sent" | "same" | "skipped" | "busy" | "failed";

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
      await markGone(x, state, `Changed from ${state.txnType === "Deposit" ? "money in" : state.txnType === "BillPayment" ? "a bill payment" : "an expense"} in the site app`);
      state = {};
    }
    const vendorId = plan.vendor ? await vendorFor(plan.vendor, vendors) : null;
    const body = plan.build(vendorId);
    const path = plan.type.toLowerCase();

    let txnId: string | null = null;
    if (state.txnId) {
      try {
        const current = await qboApi<Record<TxnType, QboTxn>>(`${path}/${state.txnId}`);
        const updated = await qboApi<Record<TxnType, { Id: string }>>(path, { method: "POST", body: updateBody(plan.type, current[plan.type], body) });
        txnId = updated[plan.type].Id;
      } catch (error) {
        // Deleted in QuickBooks by hand: it goes in again as new.
        if (!(error instanceof QboError && error.httpStatus === 400 && /not found|deleted/i.test(error.message))) throw error;
        state = {};
      }
    }
    if (!txnId) {
      if (!(await claim(x, state, conn.realmId))) return "busy";
      const existing = await findExisting(plan.type, x);
      txnId = existing ? existing.Id : (await qboApi<Record<TxnType, { Id: string }>>(path, { method: "POST", body }))[plan.type].Id;
    }

    // The receipt photo goes with it when it's new (QuickBooks keeps an old one attached: nothing is deleted).
    let attachableId = state.txnId === txnId ? (state.attachableId ?? null) : null;
    // (A bill payment's receipt stays in the app: the bill carries the paper.)
    if (plan.type !== "BillPayment" && x.receiptId && (x.receiptId !== state.receiptId || state.txnId !== txnId)) attachableId = await attachReceipt(plan.type, txnId, x);
    // The more photos with it go along too, each once.
    const moreAttached = new Set(state.txnId === txnId ? (state.moreAttached ?? []) : []);
    if (plan.type !== "BillPayment") {
      for (const [i, r] of (x.moreReceipts ?? []).entries()) {
        if (moreAttached.has(r.id)) continue;
        const pdf = r.type === "application/pdf";
        await attachFile(plan.type, txnId, r.url, r.type || "image/jpeg", `${x.ref ?? x.id} photo ${i + 2}${pdf ? ".pdf" : ".jpg"}`);
        moreAttached.add(r.id);
      }
    }

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
          ...(moreAttached.size ? { moreAttached: [...moreAttached] } : {}),
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
      message: `${x.ref ?? x.id}: ${state.txnId ? "updated" : "sent"} as ${plan.type === "Deposit" ? "a deposit" : plan.type === "BillPayment" ? "a bill payment" : "an expense"} (QuickBooks ${plan.type} ${txnId}), GHS ${amountText(x.amount)}.`,
    });
    // A bill paid down: the supplier's balance in QuickBooks has changed.
    if (plan.type === "BillPayment") await refreshVendors(true);
    return "sent";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await client
      .patch(x.id)
      .set({ "qbo.error": clip(message, 400), "qbo.failedAt": new Date().toISOString(), "qbo.realmId": conn.realmId })
      .unset(["qbo.sendingAt"])
      .commit()
      .catch(() => {});
    await writeLog({ action: "feed", ok: false, httpStatus: error instanceof QboError ? error.httpStatus : null, intuitTid: error instanceof QboError ? error.intuitTid : null, message: `${x.ref ?? x.id}: ${message}` });
    return "failed";
  }
}

/* ---------- suppliers' bills (2 Nov 2026, lib/suppliers) ---------- */

type BillDoc = {
  id: string;
  appRef: string | null;
  vendorId: string;
  supplier: string;
  date: string;
  due: string | null;
  amount: number;
  description: string;
  ref: string;
  floor: string | null;
  costClass: { id: string; name: string } | null;
  photoId: string | null;
  photoUrl: string | null;
  photoType: string | null;
  deleted: boolean;
  createdBy: string;
  qbo?: FeedState;
  rev?: string;
};
const BILL_FEED_FIELDS = `{ "id": _id, "appRef": appRef, vendorId, "supplier": coalesce(supplier, ""), date, "due": due, amount, "description": coalesce(description, ""), "ref": coalesce(ref, ""), "floor": floor, "costClass": costClass{ id, name }, "photoId": photo.asset._ref, "photoUrl": photo.asset->url, "photoType": photo.asset->mimeType, "deleted": coalesce(deleted, false), "createdBy": coalesce(createdBy, ""), "qbo": qbo, "rev": _rev }`;

/** The bills the payments may pay, by id. */
async function billLinks(): Promise<Map<string, BillLink>> {
  const rows = await getBuyersClient().fetch<Array<BillLink & { id: string }>>(
    `*[_type == "supplierBill" && string::startsWith(_id, $prefix)]{ "id": _id, vendorId, "txnId": qbo.txnId, "realmId": qbo.realmId, "deleted": coalesce(deleted, false) }`,
    { prefix: BILL_PREFIX }
  );
  return new Map(rows.map((r) => [r.id, { vendorId: r.vendorId, txnId: r.txnId ?? null, realmId: r.realmId ?? null, deleted: !!r.deleted }]));
}

async function loadBills(ids: string[] | null): Promise<BillDoc[]> {
  return getBuyersClient().fetch<BillDoc[]>(
    ids
      ? `*[_type == "supplierBill" && _id in $ids] ${BILL_FEED_FIELDS}`
      : `*[_type == "supplierBill" && string::startsWith(_id, $prefix) && (!coalesce(deleted, false) || defined(qbo.txnId))] | order(date asc)[0...2000] ${BILL_FEED_FIELDS}`,
    { ids: ids ?? [], prefix: BILL_PREFIX }
  );
}

/** A bill as QuickBooks takes it: owed to its vendor, its cost on the site's cost account with its class and location. */
export function billPlan(b: BillDoc, s: FeedSettings, lists: Lists, conn: QboConnection): Plan {
  const costAccount = s.expenseAccount;
  if (!costAccount || !lists.accounts.some((a) => a.id === costAccount)) return { send: false, reason: "Choose the cost account for site expenses", needsYou: true };
  const chosen = b.costClass ? (lists.classes.find((c) => c.id === b.costClass?.id) ?? classNamed(b.costClass.name, lists.classes)) : null;
  const locationId = locationForArea(b.floor, lists.locations)?.id ?? s.location ?? null;
  const noTax = conn.country && conn.country !== "US" ? { GlobalTaxCalculation: "NotApplicable" } : {};
  const appRef = b.appRef ?? b.id;
  const hash = createHash("sha1")
    .update(JSON.stringify([b.vendorId, b.date, b.due, b.amount, b.description, b.ref, b.floor, chosen?.id ?? null, locationId, b.photoId]))
    .digest("hex");
  const note = [`${appRef} from the site app`, b.supplier, b.description, b.createdBy ? `entered by ${b.createdBy}` : ""].filter(Boolean).join(" · ");
  return {
    send: true,
    // (Not a TxnType: bills go through sendBill.)
    type: "Purchase",
    hash,
    vendor: null,
    summary: `Bill from ${b.supplier}`,
    build: () => ({
      VendorRef: { value: b.vendorId },
      TxnDate: b.date,
      ...(b.due ? { DueDate: b.due } : {}),
      DocNumber: clip(b.ref || appRef, 21),
      PrivateNote: clip(note, 4000),
      ...(locationId ? { DepartmentRef: { value: locationId } } : {}),
      ...noTax,
      Line: [
        {
          Amount: b.amount,
          DetailType: "AccountBasedExpenseLineDetail",
          Description: clip(b.description || appRef, 4000),
          AccountBasedExpenseLineDetail: { AccountRef: { value: costAccount }, ...(chosen ? { ClassRef: { value: chosen.id } } : {}) },
        },
      ],
    }),
  };
}

async function sendBill(b: BillDoc, s: FeedSettings, lists: Lists, conn: QboConnection): Promise<Outcome> {
  const client = getBuyersClient();
  let state: FeedState = b.qbo?.realmId === conn.realmId ? (b.qbo ?? {}) : {};
  const appRef = b.appRef ?? b.id;
  // Deleted in the app (never with a payment on it): QuickBooks still has it, to remove there by hand.
  if (b.deleted) {
    if (state.txnId) {
      await markGone({ id: b.id, ref: appRef }, { ...state, txnType: "Bill" }, "Bill deleted in the site app");
      await client.patch(b.id).unset(["qbo"]).commit();
    }
    return "skipped";
  }
  const plan = billPlan(b, s, lists, conn);
  if (!plan.send) {
    await client.patch(b.id).set({ "qbo.error": plan.reason, "qbo.realmId": conn.realmId }).commit().catch(() => {});
    return "skipped";
  }
  if (state.txnId && state.hash === plan.hash && !state.error) return "same";
  try {
    const body = plan.build(null);
    let txnId: string | null = null;
    if (state.txnId) {
      try {
        const current = await qboApi<{ Bill: QboTxn }>(`bill/${state.txnId}`);
        txnId = (await qboApi<{ Bill: { Id: string } }>("bill", { method: "POST", body: { ...body, Id: current.Bill.Id, SyncToken: current.Bill.SyncToken, sparse: true } })).Bill.Id;
      } catch (error) {
        // Deleted in QuickBooks by hand: it goes in again as new.
        if (!(error instanceof QboError && error.httpStatus === 400 && /not found|deleted/i.test(error.message))) throw error;
        state = {};
      }
    }
    if (!txnId) {
      if (!(await claim(b as unknown as FeedDoc, state, conn.realmId))) return "busy";
      const rows = await query<{ Id: string; PrivateNote?: string }>(`select Id, PrivateNote from Bill where DocNumber = '${quote(clip(b.ref || appRef, 21))}'`, "Bill");
      const existing = rows.find((r) => (r.PrivateNote ?? "").startsWith(`${appRef} from the site app`));
      txnId = existing ? existing.Id : (await qboApi<{ Bill: { Id: string } }>("bill", { method: "POST", body })).Bill.Id;
    }
    // The photo of the bill goes with it when it's new.
    let attachableId = state.txnId === txnId ? (state.attachableId ?? null) : null;
    if (b.photoId && b.photoUrl && (b.photoId !== state.receiptId || state.txnId !== txnId)) {
      const type_ = b.photoType || "image/jpeg";
      attachableId = await attachFile("Bill", txnId, b.photoUrl, type_, `${appRef} ${b.supplier}`.replace(/[^\w .-]+/g, "").trim().slice(0, 80) + (type_ === "application/pdf" ? ".pdf" : ".jpg"));
    }
    await client
      .patch(b.id)
      .set({ qbo: { hash: plan.hash, txnType: "Bill", txnId, realmId: conn.realmId, receiptId: b.photoId ?? null, attachableId, syncedAt: new Date().toISOString(), error: null } })
      .commit();
    await writeLog({ action: "feed", ok: true, httpStatus: 200, intuitTid: null, message: `${appRef}: ${state.txnId ? "updated" : "sent"} as a bill from ${b.supplier} (QuickBooks Bill ${txnId}), GHS ${amountText(b.amount)}.` });
    // The payments waiting for it go now.
    const waiting = await client.fetch<string[]>(`*[_type == "siteExpense" && billId == $id]._id`, { id: b.id });
    for (const id of waiting) await feedExpense(id);
    // The supplier's balance in QuickBooks has changed: the suppliers page shows it.
    await refreshVendors(true);
    return "sent";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await client
      .patch(b.id)
      .set({ "qbo.error": clip(message, 400), "qbo.failedAt": new Date().toISOString(), "qbo.realmId": conn.realmId })
      .unset(["qbo.sendingAt"])
      .commit()
      .catch(() => {});
    await writeLog({ action: "feed", ok: false, httpStatus: error instanceof QboError ? error.httpStatus : null, intuitTid: error instanceof QboError ? error.intuitTid : null, message: `${appRef}: ${message}` });
    return "failed";
  }
}

/** Every bill new or changed (or deleted after it went in). */
async function sendBills(r: Ready, qbo: QboLists): Promise<{ sent: number; failed: number }> {
  const lists = { ...qbo, bills: new Map<string, BillLink>() };
  let sent = 0;
  let failed = 0;
  for (const b of await loadBills(null)) {
    const state = b.qbo?.realmId === r.conn.realmId ? (b.qbo ?? {}) : {};
    const plan = billPlan(b, r.settings, lists, r.conn);
    if (!b.deleted && state.txnId && !state.error && plan.send && state.hash === plan.hash) continue;
    const outcome = await sendBill(b, r.settings, lists, r.conn);
    if (outcome === "sent") sent++;
    if (outcome === "failed") failed++;
  }
  return { sent, failed };
}

/** One bill, straight after it's saved or deleted (runs after the phone already has its answer). */
export async function feedBill(id: string): Promise<void> {
  try {
    const r = await ready();
    if (!r) return;
    const lists = { ...(await qboLists()), bills: new Map<string, BillLink>() };
    for (let attempt = 0; attempt < 8; attempt++) {
      const [b] = await loadBills([id]);
      if (!b) return;
      if ((await sendBill(b, r.settings, lists, r.conn)) !== "busy") return;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  } catch (error) {
    console.error("[quickbooks bill]", id, error instanceof Error ? error.message : error);
  }
}

/* ---------- running it ---------- */

const FEED_FIELDS = FIELDS.replace(/}\s*$/, `, "qbo": qbo, "rev": _rev }`);

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
    const lists = { ...(await qboLists()), bills: await billLinks() };
    // Saved twice within seconds: the first save's run may still be adding it. Wait for that run
    // to finish, then send this version (rather than leaving it for the catch-up).
    for (let attempt = 0; attempt < 8; attempt++) {
      const [x] = await loadEntries([id], null);
      if (!x) return;
      if ((await sendOne(x, r.settings, lists, r.conn, new Map())) !== "busy") return;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  } catch (error) {
    console.error("[quickbooks feed]", id, error instanceof Error ? error.message : error);
  }
}

/** Everything new or changed (oldest first), up to `limit` and about 4 minutes. */
export async function feedPending(limit = 25): Promise<{ sent: number; failed: number; waiting: number }> {
  const r = await ready();
  if (!r) return { sent: 0, failed: 0, waiting: 0 };
  const qbo = await qboLists();
  // The suppliers' bills first: the payments that pay them wait for them.
  const bills = await sendBills(r, qbo);
  const all = await loadEntries(null, r.settings.startDate);
  const lists = { ...qbo, bills: await billLinks() };
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
  return { sent: sent + bills.sent, failed: failed + bills.failed, waiting: Math.max(0, due.length - sent) };
}

/**
 * The cron, every 15 minutes: the feed's catch-up, and once a week a small read so the saved
 * QuickBooks login (which lapses after 100 days unused) never runs out while the feed is off.
 */
export async function feedCron(): Promise<Record<string, unknown>> {
  // The classes and locations the expense form and Payday offer (read again when a few hours old), and the
  // supplier list (QuickBooks' vendors, read again when a few minutes old).
  await refreshBookLists();
  await refreshVendors();
  const result: Record<string, unknown> = await feedPending(25);
  // The books' transactions for the Spending page (read again when a few hours old; only reads).
  const history = await syncHistory();
  result.history = { count: history.count, fetchedAt: history.fetchedAt, error: history.error };
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

export async function feedStatus(qbo: QboLists, conn: QboConnection): Promise<FeedStatus> {
  const settings = await loadFeedSettings();
  const lists = { ...qbo, bills: await billLinks() };
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
