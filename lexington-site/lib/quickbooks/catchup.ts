import "server-only";

import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { QBO_CATCHUP_PREFIX } from "@/lib/site/ids";
import { TodoError } from "@/lib/todo/server";
import { classNamed, locationForArea } from "./books";
import { type CatchUp, type CatchUpLine, CATCHUP_PER_SEND, type CatchUpResult, catchUpSummary, type CatchUpSummary } from "./catchupShared";
import { qboApi, QboError } from "./client";
import { attachFile, loadFeedSettings, qboLists, type QboLists, refreshBookLists, vendorFor } from "./feed";
import { loadConnection, writeLog } from "./store";

// A sheet's lines into QuickBooks at one tap (Niko, 7 Nov 2026: his Aug-Sep sheet, "get it ready to upload and process on
// quickbooks, making sure not to add any duplicates and showing me the file before it's uploaded", then "One tap from the
// app"). The lines were prepared from the sheet and checked with him (supplier, class, floor, the receipt photos found)
// and are kept in the website, one document a sheet; the Spending page lists them and sends the ticked ones. Each
// becomes its own Expense from Cash on Hand (money in from Leo: a Deposit from his loan), like the feed's, with its
// photos attached. QuickBooks is asked first: a line it already has from here (a reply lost on the way) is just
// recorded, and one it has on that day for that amount from elsewhere is left out and said why. A line sent once is
// never sent again.

type Ref = { _ref: string };
interface DocLine {
  _key: string;
  ref: string;
  kind: "expense" | "deposit";
  date: string;
  amount: number;
  description: string;
  supplier?: string | null;
  className?: string | null;
  location?: string | null;
  floor?: string | null;
  note?: string;
  flag?: boolean;
  row: number;
  receipts?: { _key: string; asset?: Ref; caption?: string }[];
  sent?: { type: "Purchase" | "Deposit"; id: string; realmId: string; at: string; attachedKeys?: string[] } | null;
  left?: { why: string; at: string } | null;
}
interface Doc {
  _id: string;
  _rev: string;
  batch: string;
  title: string;
  lines: DocLine[];
  sendingAt?: string | null;
}

const BUSY_MS = 120_000;
const KEY = /^[a-z0-9]{1,12}$/;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const amountText = (n: number) => `GH₵ ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const quote = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
/** What every transaction from here carries at the start of its private note, after its ref. */
const MARK = " from your sheet";

/** Where a stored photo is, from its asset id (image-<sha1>-<w>x<h>-<ext>). */
function photo(ref: string | undefined): { url: string; type: string; ext: string } | null {
  const m = ref ? /^image-([a-f0-9]{40})-(\d+x\d+)-(jpg|png|webp)$/.exec(ref) : null;
  if (!m) return null;
  return {
    url: `https://cdn.sanity.io/images/${process.env.NEXT_PUBLIC_SANITY_PROJECT_ID}/${process.env.NEXT_PUBLIC_SANITY_BUYERS_DATASET}/${m[1]}-${m[2]}.${m[3]}`,
    type: m[3] === "jpg" ? "image/jpeg" : `image/${m[3]}`,
    ext: m[3],
  };
}

async function loadDoc(batch?: string): Promise<Doc | null> {
  return getBuyersClient().fetch<Doc | null>(
    batch
      ? `*[_type == "qboCatchup" && _id == $id][0]{ _id, _rev, batch, title, lines, sendingAt }`
      : `*[_type == "qboCatchup" && string::startsWith(_id, $prefix)] | order(createdAt desc)[0]{ _id, _rev, batch, title, lines, sendingAt }`,
    { id: `${QBO_CATCHUP_PREFIX}${batch ?? ""}`, prefix: QBO_CATCHUP_PREFIX }
  );
}

function view(doc: Doc, realmId: string | null): CatchUp {
  return {
    batch: doc.batch,
    title: doc.title,
    lines: (doc.lines ?? []).map(
      (l): CatchUpLine => ({
        key: l._key,
        ref: l.ref,
        kind: l.kind,
        date: l.date,
        amount: l.amount,
        description: l.description,
        supplier: l.supplier ?? null,
        className: l.className ?? null,
        location: l.location ?? null,
        floor: l.floor ?? null,
        note: l.note ?? "",
        flag: !!l.flag,
        row: l.row,
        receipts: (l.receipts ?? []).flatMap((r) => {
          const p = photo(r.asset?._ref);
          return p ? [{ key: r._key, url: p.url, thumb: `${p.url}?w=240&h=240&fit=max&auto=format`, caption: r.caption ?? "" }] : [];
        }),
        // Sent to another company (QuickBooks reconnected to different books) doesn't count.
        sent: l.sent && (!realmId || l.sent.realmId === realmId) ? { type: l.sent.type, id: l.sent.id, attached: l.sent.attachedKeys?.length ?? 0 } : null,
        left: l.left?.why ?? null,
      })
    ),
  };
}

/** The newest sheet waiting, as the Spending page lists it (null: none). */
export async function catchUpData(batch?: string): Promise<CatchUp | null> {
  const [doc, conn] = await Promise.all([loadDoc(batch), loadConnection().catch(() => null)]);
  return doc ? view(doc, conn?.realmId ?? null) : null;
}

/** What the Spending page's card says (null: no sheet waiting). */
export async function catchUpCard(): Promise<CatchUpSummary | null> {
  const c = await catchUpData().catch(() => null);
  return c ? catchUpSummary(c) : null;
}

/** The keys as sent, checked: a few at a time, each once. */
export function cleanCatchUpKeys(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new TodoError(400, "Tick at least one line to send.");
  if (value.length > CATCHUP_PER_SEND) throw new TodoError(400, `At most ${CATCHUP_PER_SEND} at a time.`);
  const keys = value.map((v) => (typeof v === "string" ? v : ""));
  if (keys.some((k) => !KEY.test(k)) || new Set(keys).size !== keys.length) throw new TodoError(400, "One of them isn't a line on the list.");
  return keys;
}

interface Books {
  lists: QboLists;
  payFrom: { id: string; type: string };
  costAccount: string;
  leoAccount: string | null;
  noTax: Record<string, string>;
  realmId: string;
  vendors: Map<string, string>;
}

async function query<T>(q: string, entity: string): Promise<T[]> {
  const reply = await qboApi<{ QueryResponse?: Record<string, unknown> }>("query", { query: { query: q } });
  return ((reply.QueryResponse?.[entity] as T[] | undefined) ?? []).slice();
}

/** The line's location in the books: found by name ("2nd floor" is "Second Floor"), or added to QuickBooks once. */
async function locationId(name: string | null | undefined, b: Books): Promise<string | null> {
  if (!name) return null;
  const known = locationForArea(name, b.lists.locations);
  if (known) return known.id;
  const made = (await qboApi<{ Department: { Id: string; Name: string } }>("department", { method: "POST", body: { Name: clip(name.trim(), 100) } })).Department;
  b.lists.locations.push({ id: made.Id, name: made.Name });
  await writeLog({ action: "api", ok: true, httpStatus: 200, intuitTid: null, message: `From your sheet: the location "${made.Name}" added (${made.Id})` });
  return made.Id;
}

function bodyFor(l: DocLine, title: string, b: Books, vendorId: string | null, location: string | null, classId: string | null): Record<string, unknown> {
  const note = clip([`${l.ref}${MARK}`, `"${title}", row ${l.row}`, l.floor ? `floor: ${l.floor}` : "", l.note ?? ""].filter(Boolean).join(" · "), 4000);
  if (l.kind === "deposit") {
    return {
      TxnDate: l.date,
      DepositToAccountRef: { value: b.payFrom.id },
      PrivateNote: note,
      ...b.noTax,
      Line: [{ Amount: l.amount, DetailType: "DepositLineDetail", Description: clip(l.description, 4000), DepositLineDetail: { AccountRef: { value: b.leoAccount } } }],
    };
  }
  return {
    TxnDate: l.date,
    PaymentType: b.payFrom.type === "Credit Card" ? "CreditCard" : "Cash",
    AccountRef: { value: b.payFrom.id },
    DocNumber: clip(l.ref, 21),
    PrivateNote: note,
    ...(vendorId ? { EntityRef: { value: vendorId, type: "Vendor" } } : {}),
    ...(location ? { DepartmentRef: { value: location } } : {}),
    ...b.noTax,
    Line: [
      {
        Amount: l.amount,
        DetailType: "AccountBasedExpenseLineDetail",
        Description: clip(l.description, 4000),
        AccountBasedExpenseLineDetail: { AccountRef: { value: b.costAccount }, ...(classId ? { ClassRef: { value: classId } } : {}) },
      },
    ],
  };
}

const at = (key: string, field: string) => `lines[_key=="${key}"].${field}`;

/** Each photo of a line not attached yet, attached (and kept as attached one by one, so a timeout loses none). */
async function attachPhotos(doc: Doc, l: DocLine, type: "Purchase" | "Deposit", txnId: string): Promise<number> {
  const done = new Set(l.sent?.attachedKeys ?? []);
  let n = 0;
  for (const [i, r] of (l.receipts ?? []).entries()) {
    const p = photo(r.asset?._ref);
    if (!p || done.has(r._key)) continue;
    const name = clip(`${l.ref} ${l.date} ${l.supplier || "receipt"} ${i + 1}`.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim(), 90);
    await attachFile(type, txnId, p.url, p.type, `${name}.${p.ext}`);
    done.add(r._key);
    n++;
    await getBuyersClient().patch(doc._id).set({ [at(l._key, "sent.attachedKeys")]: [...done] }).commit();
  }
  return n;
}

async function sendLine(doc: Doc, l: DocLine, b: Books): Promise<CatchUpResult> {
  const type: "Purchase" | "Deposit" = l.kind === "deposit" ? "Deposit" : "Purchase";
  if (l.left) return { key: l._key, outcome: "left", why: l.left.why };
  if (l.sent && l.sent.realmId === b.realmId) {
    // In already: only photos that didn't make it last time.
    await attachPhotos(doc, l, l.sent.type, l.sent.id);
    return { key: l._key, outcome: "already" };
  }
  if (l.kind === "deposit" && !b.leoAccount) return { key: l._key, outcome: "failed", why: "Choose where money from Leo goes on the QuickBooks page first." };
  const classId = l.className ? (classNamed(l.className, b.lists.classes)?.id ?? null) : null;
  if (l.className && !classId) return { key: l._key, outcome: "failed", why: `QuickBooks has no class "${l.className}".` };

  // What QuickBooks has on that day: this line's own (sent, but the answer was lost), or the same amount from elsewhere.
  const sameDay = await query<{ Id: string; PrivateNote?: string; TotalAmt?: number }>(`select Id, PrivateNote, TotalAmt from ${type} where TxnDate = '${quote(l.date)}' maxresults 1000`, type);
  let txnId = sameDay.find((t) => (t.PrivateNote ?? "").startsWith(`${l.ref}${MARK}`))?.Id ?? null;
  if (!txnId) {
    const there = sameDay.find((t) => Math.abs(Number(t.TotalAmt ?? 0) - l.amount) < 0.005 && !(t.PrivateNote ?? "").includes(MARK));
    if (there) {
      const why = `QuickBooks already has ${amountText(l.amount)} on that day (${type === "Deposit" ? "deposit" : "expense"} ${there.Id}): left out so it isn't in twice.`;
      await getBuyersClient().patch(doc._id).set({ [at(l._key, "left")]: { why, at: new Date().toISOString() } }).commit();
      return { key: l._key, outcome: "left", why };
    }
    const vendorId = l.kind === "expense" && l.supplier?.trim() ? await vendorFor(l.supplier, b.vendors) : null;
    const location = l.kind === "expense" ? await locationId(l.location, b) : null;
    const made = await qboApi<Record<string, { Id: string } | undefined>>(type.toLowerCase(), { method: "POST", body: bodyFor(l, doc.title, b, vendorId, location, classId) });
    txnId = made[type]?.Id ?? null;
    if (!txnId) throw new QboError(`QuickBooks didn't say which ${type === "Deposit" ? "deposit" : "expense"} it made.`);
  }
  const sent = { type, id: txnId, realmId: b.realmId, at: new Date().toISOString(), attachedKeys: [] as string[] };
  await getBuyersClient().patch(doc._id).set({ [at(l._key, "sent")]: sent }).commit();
  await writeLog({ action: "api", ok: true, httpStatus: 200, intuitTid: null, message: `From your sheet: ${l.ref} -> ${type} ${txnId} (${amountText(l.amount)}, ${l.date})` });
  await attachPhotos(doc, { ...l, sent }, type, txnId);
  return { key: l._key, outcome: "sent" };
}

/**
 * The ticked lines into QuickBooks, one by one (a few per request: the page sends the rest after). One send at a time:
 * a second screen waits. Answers each line's outcome and the list as it is now.
 */
export async function sendCatchUp(batch: string, keys: readonly string[]): Promise<{ results: CatchUpResult[]; catchUp: CatchUp }> {
  if (!/^[a-z0-9-]{1,40}$/.test(batch)) throw new TodoError(404, "That sheet isn't here.");
  const client = getBuyersClient();
  const doc = await loadDoc(batch);
  if (!doc) throw new TodoError(404, "That sheet isn't here.");
  const conn = await loadConnection();
  if (!conn || conn.status !== "connected") throw new TodoError(409, "QuickBooks isn't connected: connect it on the QuickBooks page first.");
  const settings = await loadFeedSettings();
  if (settings.realmId && settings.realmId !== conn.realmId) throw new TodoError(409, "The QuickBooks page's settings are for other books: save them again first.");
  const lists = await qboLists();
  const payId = settings.payFrom.Cash ?? null;
  const pay = lists.accounts.find((a) => a.id === payId);
  if (!pay) throw new TodoError(409, 'Choose the QuickBooks account for "Cash" on the QuickBooks page first.');
  if (!settings.expenseAccount || !lists.accounts.some((a) => a.id === settings.expenseAccount)) throw new TodoError(409, "Choose the cost account for site expenses on the QuickBooks page first.");
  const leoRule = settings.inflowRules.find((r) => r.match.trim() && "leo".includes(r.match.trim().toLowerCase()));

  if (doc.sendingAt && Date.now() - Date.parse(doc.sendingAt) < BUSY_MS) throw new TodoError(409, "They're being sent from another screen: try again in a minute.");
  try {
    await client.patch(doc._id).ifRevisionId(doc._rev).set({ sendingAt: new Date().toISOString() }).commit();
  } catch {
    throw new TodoError(409, "They're being sent from another screen: try again in a minute.");
  }

  const books: Books = {
    lists,
    payFrom: { id: pay.id, type: pay.type },
    costAccount: settings.expenseAccount,
    leoAccount: leoRule && lists.accounts.some((a) => a.id === leoRule.account) ? leoRule.account : null,
    noTax: conn.country && conn.country !== "US" ? { GlobalTaxCalculation: "NotApplicable" } : {},
    realmId: conn.realmId,
    vendors: new Map(),
  };
  const locations = lists.locations.length;
  const results: CatchUpResult[] = [];
  try {
    for (const key of keys) {
      const line = doc.lines.find((l) => l._key === key);
      if (!line) {
        results.push({ key, outcome: "failed", why: "It isn't on the list any more." });
        continue;
      }
      let result: CatchUpResult;
      let failure: unknown = null;
      try {
        result = await sendLine(doc, line, books);
      } catch (error) {
        failure = error;
        result = { key, outcome: "failed", why: error instanceof QboError ? error.message : error instanceof Error ? error.message : "QuickBooks could not be reached." };
      }
      if (result.outcome === "failed") {
        await writeLog({
          action: "api",
          ok: false,
          httpStatus: failure instanceof QboError ? failure.httpStatus : null,
          intuitTid: failure instanceof QboError ? failure.intuitTid : null,
          message: `From your sheet: ${line.ref} not sent: ${result.why ?? "?"}`,
        });
      }
      results.push(result);
    }
  } finally {
    await client.patch(doc._id).unset(["sendingAt"]).commit().catch(() => {});
  }
  // A location added (Second Floor): the expense form offers it too.
  if (books.lists.locations.length !== locations) await refreshBookLists(true);
  const after = await loadDoc(batch);
  return { results, catchUp: view(after ?? doc, conn.realmId) };
}
