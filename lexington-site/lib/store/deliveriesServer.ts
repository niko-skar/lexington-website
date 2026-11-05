import "server-only";

import { notifyOwner } from "@/lib/alerts/notify";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { BILL_PREFIX, EXPENSE_PREFIX, isId, ITEM_PREFIX, MOVE_PREFIX, newId, ORDER_PREFIX } from "@/lib/site/ids";
import { cleanPhotoRef, cleanText, photoRef, TodoError } from "@/lib/todo/server";
import type { TodoMe } from "@/lib/todo/shared";
import { DELIVERIES_FROM, EXPECT_DAYS, MATCH_DAYS, MAX_DELIVERY_NOTE, ORDER_EXPECT_DAYS, qtyWords, type ExpectedLine, type OpenArrival } from "./deliveries";
import { getItem, itemForPurchase } from "./server";
import type { StoreItem } from "./shared";

// Deliveries at the store door (lib/store/deliveries.ts says what and why). A check-in is a "storeMove" of kind
// "arrived": { itemId, qty (what came), expected (what was paid for, when it's a paid purchase's), diff (what it
// changes the stock by), expenseId?, poId?, lineKey?, ref? }. An expense line that pays for goods checked in already
// carries alreadyIn (the check-in's id, or a count's): it doesn't add the stock again.

const DAY = 86_400_000;
const round = (n: number) => Math.round(n * 1000) / 1000;
const STORE_LINK = "/todo/store";

type Line = { itemId: string | null; qty: number | null; material: string | null; alreadyIn?: string | null };
type ExpenseRow = { id: string; ref: string | null; date: string; supplier: string; billId: string | null; main: Line | null; more: Line[] | null };
type OrderRow = { id: string; number: string; supplier: string; orderedAt: string | null; neededBy: string; lines: Array<{ key: string; name: string; qty: number | null; unit: string | null; itemId: string | null }> | null };
type ArrivedRow = { expenseId: string | null; itemId: string; poId: string | null; lineKey: string | null };

/** The lines of an expense into the store room, one per item (two lines of one item add up). */
function storeLines(x: Pick<ExpenseRow, "main" | "more">, withTied = false): Array<{ itemId: string; qty: number; material: string }> {
  const byItem = new Map<string, { itemId: string; qty: number; material: string }>();
  for (const l of [...(x.main ? [x.main] : []), ...(x.more ?? [])]) {
    if (!l.itemId || (!withTied && l.alreadyIn)) continue;
    const had = byItem.get(l.itemId);
    byItem.set(l.itemId, { itemId: l.itemId, qty: round((had?.qty ?? 0) + (l.qty ?? 1)), material: had?.material ?? l.material ?? "" });
  }
  return [...byItem.values()];
}

/** What's to come in at the store: paid purchases into the store room not ticked yet, and placed orders' materials. */
export async function expectedLines(me: TodoMe, items: readonly StoreItem[]): Promise<ExpectedLine[]> {
  const now = Date.now();
  const data = await getBuyersClient().fetch<{ expenses: ExpenseRow[]; orders: OrderRow[]; arrived: ArrivedRow[]; billOrders: string[] }>(
    `{
      "expenses": *[_type == "siteExpense" && string::startsWith(_id, $expensePrefix) && coalesce(kind, "expense") == "expense" && createdAt >= $from && createdAt >= $since && !defined(poId) && (toStore == true || count(moreLines[toStore == true]) > 0)] | order(createdAt desc)[0...300]{
        "id": _id, ref, date, "supplier": coalesce(supplier, ""), billId,
        "main": select(toStore == true => { itemId, qty, material, alreadyIn }),
        "more": moreLines[toStore == true]{ itemId, qty, material, alreadyIn }
      },
      "orders": *[_type == "purchaseOrder" && string::startsWith(_id, $orderPrefix) && status == "ordered" && coalesce(category, "Material") == "Material" && orderedAt >= $orderSince] | order(neededBy asc)[0...200]{
        "id": _id, number, "supplier": coalesce(supplier, ""), orderedAt, neededBy, "lines": lines[]{ "key": _key, name, qty, unit, itemId }
      },
      "arrived": *[_type == "storeMove" && string::startsWith(_id, $movePrefix) && kind == "arrived" && (defined(expenseId) || defined(poId))]{ expenseId, itemId, poId, lineKey },
      "billOrders": *[_type == "supplierBill" && string::startsWith(_id, $billPrefix) && defined(poId)]._id
    }`,
    {
      expensePrefix: EXPENSE_PREFIX,
      orderPrefix: ORDER_PREFIX,
      movePrefix: MOVE_PREFIX,
      billPrefix: BILL_PREFIX,
      from: DELIVERIES_FROM,
      since: new Date(now - EXPECT_DAYS * DAY).toISOString(),
      orderSince: new Date(now - ORDER_EXPECT_DAYS * DAY).toISOString(),
    }
  );
  const office = me.kind === "admin";
  const itemById = new Map(items.map((i) => [i.id, i]));
  const ticked = new Set(data.arrived.filter((a) => a.expenseId).map((a) => `${a.expenseId}:${a.itemId}`));
  const orderTicked = new Set(data.arrived.filter((a) => a.poId && a.lineKey).map((a) => `${a.poId}:${a.lineKey}`));
  const billOrders = new Set(data.billOrders);
  const paid: ExpectedLine[] = [];
  for (const x of data.expenses) {
    // A bill made from an order: its goods are the order's lines.
    if (x.billId && billOrders.has(x.billId)) continue;
    for (const l of storeLines(x)) {
      if (ticked.has(`${x.id}:${l.itemId}`)) continue;
      const item = itemById.get(l.itemId);
      paid.push({ key: `x:${x.id}:${l.itemId}`, kind: "expense", id: x.id, line: null, itemId: l.itemId, name: item?.name ?? l.material, qty: l.qty, unit: item?.unit ?? "", ref: x.ref, date: x.date, neededBy: null, ...(office ? { supplier: x.supplier } : {}) });
    }
  }
  const ordered: ExpectedLine[] = [];
  for (const o of data.orders) {
    for (const l of o.lines ?? []) {
      if (orderTicked.has(`${o.id}:${l.key}`)) continue;
      const item = l.itemId ? itemById.get(l.itemId) : undefined;
      ordered.push({
        key: `o:${o.id}:${l.key}`,
        kind: "order",
        id: o.id,
        line: l.key,
        itemId: item?.id ?? null,
        name: item?.name ?? l.name,
        qty: l.qty ?? 1,
        unit: l.unit || item?.unit || "",
        ref: o.number,
        date: (o.orderedAt ?? "").slice(0, 10),
        neededBy: o.neededBy,
        ...(office ? { supplier: o.supplier } : {}),
      });
    }
  }
  // Paid already (it's likely on its way, or here) first, the newest first; then the orders, the soonest needed first.
  return [...paid.sort((a, b) => b.date.localeCompare(a.date)), ...ordered];
}

/** Ids of check-ins (and counts) an expense line is tied to already. */
async function tiedIds(): Promise<Set<string>> {
  const rows = await getBuyersClient().fetch<Array<{ main: string | null; more: string[] | null }>>(
    `*[_type == "siteExpense" && string::startsWith(_id, $prefix) && (defined(alreadyIn) || count(moreLines[defined(alreadyIn)]) > 0)]{ "main": alreadyIn, "more": moreLines[defined(alreadyIn)].alreadyIn }`,
    { prefix: EXPENSE_PREFIX }
  );
  return new Set(rows.flatMap((r) => [r.main, ...(r.more ?? [])]).filter((id): id is string => !!id));
}

/** Checked in and not paid for yet (the last weeks'): deliveries, and what counts found more than the record. */
export async function openArrivals(): Promise<OpenArrival[]> {
  const [moves, tied] = await Promise.all([
    getBuyersClient().fetch<OpenArrival[]>(
      `*[_type == "storeMove" && string::startsWith(_id, $prefix) && at >= $since && diff > 0 && ((kind == "arrived" && !defined(expenseId)) || kind == "count")] | order(at desc)[0...200]{ "moveId": _id, itemId, "qty": diff, at, "by": coalesce(by, ""), "kind": select(kind == "count" && coalesce(opening, false) => "added", kind) }`,
      { prefix: MOVE_PREFIX, since: new Date(Date.now() - MATCH_DAYS * DAY).toISOString() }
    ),
    tiedIds(),
  ]);
  return moves.filter((m) => !tied.has(m.moveId));
}

/**
 * The check-in an expense line pays for ("Already in the store?" answered yes): a delivery not paid for yet, or a
 * count that found more, of the same item, not tied to another payment. `self`: the expense being changed.
 */
export async function cleanAlreadyIn(value: unknown, itemId: string | null, self: string | null): Promise<string | null> {
  if (value === null || value === undefined || value === "" || !itemId) return null;
  if (!isId(MOVE_PREFIX, value)) throw new TodoError(404, "That delivery isn't there any more: answer \"Already in the store?\" again.");
  const client = getBuyersClient();
  const m = await client.fetch<{ kind: string; itemId: string; diff: number | null; expenseId: string | null; opening: boolean | null } | null>(
    `*[_id == $id && _type == "storeMove"][0]{ kind, itemId, diff, expenseId, opening }`,
    { id: value }
  );
  const fits = !!m && (m.diff ?? 0) > 0 && m.itemId === itemId && (m.kind === "arrived" ? !m.expenseId : m.kind === "count");
  if (!fits) throw new TodoError(409, "That delivery can't be this one: answer \"Already in the store?\" again.");
  const other = await client.fetch<string | null>(`*[_type == "siteExpense" && _id != $self && (alreadyIn == $id || $id in moreLines[].alreadyIn)][0].ref`, { id: value, self: self ?? "" });
  if (other) throw new TodoError(409, `That delivery is paid for already (${other}).`);
  return value;
}

/** A payment for an order (or for its bill): the order's check-ins not paid for yet, by item (the expense ties its lines to them). */
export async function orderCheckIns(order: string): Promise<Map<string, string>> {
  const [moves, tied] = await Promise.all([
    getBuyersClient().fetch<Array<{ id: string; itemId: string }>>(`*[_type == "storeMove" && kind == "arrived" && poId == $po && !defined(expenseId)] | order(at asc){ "id": _id, itemId }`, { po: order }),
    tiedIds(),
  ]);
  const out = new Map<string, string>();
  for (const m of moves) if (!tied.has(m.id) && !out.has(m.itemId)) out.set(m.itemId, m.id);
  return out;
}

/** The order a payment is for: its own, or its bill's. */
export async function orderOfPayment(poId: string | null | undefined, billId: string | null | undefined): Promise<string | null> {
  if (poId) return poId;
  if (!billId) return null;
  return getBuyersClient().fetch<string | null>(`*[_id == $id && _type == "supplierBill"][0].poId`, { id: billId });
}

/* ---------- checking in ---------- */

function cleanQty(value: unknown): number {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) throw new TodoError(400, "Type how many came.");
  return round(n);
}

async function checkIn(me: TodoMe, fields: Record<string, unknown>): Promise<string> {
  const id = newId(MOVE_PREFIX);
  await getBuyersClient().create({ _id: id, _type: "storeMove", kind: "arrived", ...fields, at: new Date().toISOString(), by: me.name, byId: me.id });
  return id;
}

/** A site login says less came than was paid for or ordered: the office hears. */
async function shortAlert(me: TodoMe, name: string, came: number, expected: number, unit: string, ref: string | null): Promise<void> {
  if (me.kind === "admin" || came >= expected) return;
  await notifyOwner({
    kind: "store",
    title: `Only ${qtyWords(came, unit)} of ${qtyWords(expected, unit)} ${name} came`,
    lines: [`Checked in by ${me.name}${ref ? `, for ${ref}` : ""}`],
    links: [{ label: "Open the store", url: STORE_LINK }],
    open: STORE_LINK,
  }).catch(() => {});
}

/**
 * What's expected came in:
 *   { kind: "expense", id, itemId, qty }  a paid purchase's goods (all of it, or what came): the stock had it already
 *   { kind: "order", id, line, qty }      a placed order's line: stock now (or its payment's goods, if paid already)
 * Anyone using the store. { note?, photoId? } with either.
 */
export async function arrive(me: TodoMe, body: Record<string, unknown>): Promise<void> {
  const qty = cleanQty(body.qty);
  const note = cleanText(body.note, MAX_DELIVERY_NOTE, "note");
  const photoId = cleanPhotoRef(body.photoId);
  const extra = { note, ...(photoId ? { photo: photoRef(photoId) } : {}) };
  const client = getBuyersClient();

  if (body.kind === "expense") {
    if (!isId(EXPENSE_PREFIX, body.id) || !isId(ITEM_PREFIX, body.itemId)) throw new TodoError(404, "That isn't waiting to come in any more. Refresh the page.");
    const [x, done] = await Promise.all([
      client.fetch<(Pick<ExpenseRow, "ref" | "main" | "more"> & { kind: string }) | null>(
        `*[_id == $id && _type == "siteExpense"][0]{ ref, "kind": coalesce(kind, "expense"), "main": select(toStore == true => { itemId, qty, material, alreadyIn }), "more": moreLines[toStore == true]{ itemId, qty, material, alreadyIn } }`,
        { id: body.id }
      ),
      client.fetch<number>(`count(*[_type == "storeMove" && kind == "arrived" && expenseId == $id && itemId == $item])`, { id: body.id, item: body.itemId }),
    ]);
    const line = x ? storeLines(x).find((l) => l.itemId === body.itemId) : undefined;
    if (!x || !line) throw new TodoError(404, "That isn't waiting to come in any more. Refresh the page.");
    if (done) throw new TodoError(409, "It's been ticked already.");
    const item = await getItem(line.itemId);
    await checkIn(me, { itemId: line.itemId, qty, expected: line.qty, diff: round(qty - line.qty), expenseId: body.id, ref: x.ref, ...extra });
    await shortAlert(me, item?.name ?? line.material, qty, line.qty, item?.unit ?? "", x.ref);
    return;
  }

  if (body.kind === "order") {
    if (!isId(ORDER_PREFIX, body.id) || typeof body.line !== "string" || !/^[a-zA-Z0-9-]{1,40}$/.test(body.line)) throw new TodoError(404, "That order isn't waiting to come in any more. Refresh the page.");
    const [o, done] = await Promise.all([
      client.fetch<{ number: string; status: string; line: { name: string; qty: number | null; unit: string | null; itemId: string | null } | null } | null>(
        `*[_id == $id && _type == "purchaseOrder"][0]{ number, status, "line": lines[_key == $line][0]{ name, qty, unit, itemId } }`,
        { id: body.id, line: body.line }
      ),
      client.fetch<number>(`count(*[_type == "storeMove" && kind == "arrived" && poId == $id && lineKey == $line])`, { id: body.id, line: body.line }),
    ]);
    if (!o?.line) throw new TodoError(404, "That order isn't waiting to come in any more. Refresh the page.");
    if (o.status !== "ordered") throw new TodoError(409, "That order isn't placed any more. Ask the office.");
    if (done) throw new TodoError(409, "It's been ticked already.");
    // The store item it is (a new thing on the order becomes one now: the office checks a site login's).
    const known = o.line.itemId ? await getItem(o.line.itemId) : null;
    const itemId = known?.id ?? (await itemForPurchase(me, o.line.name, o.line.unit)).id;
    const item = known ?? (await getItem(itemId));
    // Paid already (its goods counted with the payment): this is them coming in. Else they're stock from now on, and
    // the payment, when it's logged, is tied to this check-in.
    const bills = await client.fetch<string[]>(`*[_type == "supplierBill" && poId == $po]._id`, { po: body.id });
    const payments = await client.fetch<Array<{ id: string } & Pick<ExpenseRow, "main" | "more">>>(
      `*[_type == "siteExpense" && string::startsWith(_id, $prefix) && (poId == $po || billId in $bills)] | order(createdAt asc){ "id": _id, "main": select(toStore == true => { itemId, qty, material, alreadyIn }), "more": moreLines[toStore == true]{ itemId, qty, material, alreadyIn } }`,
      { prefix: EXPENSE_PREFIX, po: body.id, bills }
    );
    const ticked = new Set(await client.fetch<string[]>(`*[_type == "storeMove" && kind == "arrived" && defined(expenseId) && itemId == $item].expenseId`, { item: itemId }));
    const paid = payments.map((p) => ({ id: p.id, line: storeLines(p).find((l) => l.itemId === itemId) })).find((p) => p.line && !ticked.has(p.id));
    const expected = o.line.qty ?? 1;
    if (paid?.line) {
      await checkIn(me, { itemId, qty, expected: paid.line.qty, diff: round(qty - paid.line.qty), expenseId: paid.id, poId: body.id, lineKey: body.line, ref: o.number, ...extra });
      await shortAlert(me, item?.name ?? o.line.name, qty, paid.line.qty, item?.unit ?? o.line.unit ?? "", o.number);
    } else {
      await checkIn(me, { itemId, qty, expected, diff: qty, poId: body.id, lineKey: body.line, ref: o.number, ...extra });
      await shortAlert(me, item?.name ?? o.line.name, qty, expected, item?.unit ?? o.line.unit ?? "", o.number);
    }
    return;
  }
  throw new TodoError(400, "That button isn't known.");
}

/** Something came in that nobody said was coming: { itemId } (a store item) or { name, unit } (new), { qty, note?, photoId? }. */
export async function walkIn(me: TodoMe, body: Record<string, unknown>): Promise<void> {
  const qty = cleanQty(body.qty);
  if (!(qty > 0)) throw new TodoError(400, "Type how many came.");
  const note = cleanText(body.note, MAX_DELIVERY_NOTE, "note");
  const photoId = cleanPhotoRef(body.photoId);
  let itemId: string;
  if (body.itemId !== undefined && body.itemId !== null && body.itemId !== "") {
    if (!isId(ITEM_PREFIX, body.itemId)) throw new TodoError(404, "That item isn't in the store any more.");
    const item = await getItem(body.itemId);
    if (!item) throw new TodoError(404, "That item isn't in the store any more.");
    itemId = item.id;
  } else {
    const name = cleanText(body.name, 60, "name").replace(/\s+/g, " ");
    if (!name) throw new TodoError(400, "Say what came, e.g. Cement 50kg.");
    itemId = (await itemForPurchase(me, name, body.unit)).id;
  }
  await checkIn(me, { itemId, qty, diff: qty, note, ...(photoId ? { photo: photoRef(photoId) } : {}) });
}

/** A check-in (or a count) taken off: a payment tied to it adds the stock itself again. */
export async function untie(moveId: string): Promise<void> {
  const client = getBuyersClient();
  const rows = await client.fetch<Array<{ id: string; main: boolean; keys: string[] | null }>>(
    `*[_type == "siteExpense" && (alreadyIn == $id || $id in moreLines[].alreadyIn)]{ "id": _id, "main": alreadyIn == $id, "keys": moreLines[alreadyIn == $id]._key }`,
    { id: moveId }
  );
  for (const r of rows) {
    const paths = [...(r.main ? ["alreadyIn"] : []), ...(r.keys ?? []).map((k) => `moreLines[_key=="${k}"].alreadyIn`)];
    if (paths.length) await client.patch(r.id).unset(paths).commit();
  }
}
