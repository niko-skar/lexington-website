import "server-only";

import { boxOf, gridLines, linePos, slabCorners } from "@/lib/asbuilt/geometry";
import { floorId, SEED_FLOORS } from "@/lib/asbuilt/store";
import type { Floor } from "@/lib/asbuilt/types";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { POUR_ESTIMATE_PREFIX } from "@/lib/site/ids";
import { cleanText, TodoError } from "@/lib/todo/server";
import type { TodoMe } from "@/lib/todo/shared";
import {
  DEFAULT_EXTRA,
  estimate,
  ESTIMATE_KINDS,
  EXTRA_CHOICES,
  MAX_HEIGHT,
  type Box4,
  type EstFloor,
  type EstimateInput,
  type EstimateKind,
  type EstimateResult,
  type EstItem,
  type EstOpening,
  type PourOrder,
  type SavedEstimate,
  type SavedOrder,
} from "./estimate";

// The concrete estimate's side on the server (lib/concrete/estimate.ts says what and why): the building from the
// as-built record (read only: the as-built page keeps it), and each pour's estimate and order in its own record
// (pourestimate-<live|dev>-<pour id>), so the roll call's pour record is untouched.

type Data = Record<string, unknown>;
const isObj = (v: unknown): v is Data => !!v && typeof v === "object" && !Array.isArray(v);
const r1 = (v: number) => Math.round(v * 10) / 10;
const box4 = (b: { x0: number; y0: number; x1: number; y1: number }): Box4 => [r1(b.x0), r1(b.y0), r1(b.x1), r1(b.y1)];

/* ---------- the building ---------- */

function compactFloor(f: Floor, next: Floor | null): EstFloor {
  const grid = (axis: "x" | "y") => gridLines(f, axis).map((g) => ({ id: g.id, pos: r1(linePos(f, axis, g.id, "actual") ?? g.design) }));
  const items: EstItem[] = [];
  const openings: EstOpening[] = [];
  for (const el of f.columns ?? []) {
    const b = boxOf(f, el, "actual");
    if (b) items.push({ id: `c:${el._key}`, name: el.name, ref: `${el.x}/${el.y}`, kind: el.kind === "wall" ? "wall" : "column", box: box4(b) });
  }
  for (const el of f.cores ?? []) {
    const b = boxOf(f, el, "actual");
    if (!b) continue;
    const wall = (el.actual ?? el.design).wall;
    items.push({ id: `k:${el._key}`, name: el.name, ref: `${el.x}/${el.y}`, kind: "lift", box: box4(b), wall, door: el.door ? { side: el.door.side, width: el.door.width } : null });
    // The shaft inside is a hole in every slab.
    if (wall > 0 && b.x1 - b.x0 > 2 * wall && b.y1 - b.y0 > 2 * wall) openings.push({ name: `${el.name} shaft`, kind: "lift", box: box4({ x0: b.x0 + wall, y0: b.y0 + wall, x1: b.x1 - wall, y1: b.y1 - wall }) });
  }
  for (const el of f.openings ?? []) {
    if (el.removed) continue;
    const b = boxOf(f, el, "actual");
    if (b) openings.push({ name: el.name, kind: el.kind, box: box4(b) });
  }
  const outline = slabCorners(f, "actual");
  return {
    key: f.key,
    name: f.name,
    short: f.short,
    level: f.level,
    next: next ? { key: next.key, name: next.name, level: next.level } : null,
    xs: grid("x"),
    ys: grid("y"),
    outline: outline ? outline.map(([x, y]) => [r1(x), r1(y)] as [number, number]) : null,
    items,
    openings,
  };
}

/** Every floor of the building as the estimate needs it: as built where taped, else the drawings. */
export async function estimateFloors(): Promise<EstFloor[]> {
  const ids = SEED_FLOORS.map((f) => floorId(f.key));
  const docs = await getBuyersClient().fetch<Floor[]>(`*[_type == "asbuiltFloor" && _id in $ids]{ ..., "log": [] }`, { ids });
  // A floor the as-built page hasn't made yet is its drawing (nothing is written here).
  const floors = SEED_FLOORS.map((seed) => docs.find((d) => d._id === floorId(seed.key)) ?? ({ ...seed, _id: floorId(seed.key) } as Floor)).sort((a, b) => a.order - b.order);
  return floors.map((f, i) => compactFloor(f, floors[i + 1] ?? null));
}

/* ---------- what's picked, checked ---------- */

const FLOOR_RE = /^[a-z0-9]{1,8}$/;
const GRID_RE = /^[A-Za-z0-9]{1,4}$/;
const ITEM_RE = /^[ck]:[A-Za-z0-9_.-]{1,60}$/;
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

function cleanInput(value: unknown): EstimateInput {
  if (!isObj(value)) throw new TodoError(400, "The concrete worked out didn't come through: try again.");
  const kind = ESTIMATE_KINDS.find((k) => k === value.kind) as EstimateKind | undefined;
  if (!kind) throw new TodoError(400, "Pick columns, slab, both or other.");
  const extra = num(value.extra);
  const out: EstimateInput = { kind, extra: EXTRA_CHOICES.some((e) => e === extra) ? (extra as number) : DEFAULT_EXTRA };
  const floor = (v: unknown) => (typeof v === "string" && FLOOR_RE.test(v) ? v : "");
  const grid = (v: unknown) => (typeof v === "string" && GRID_RE.test(v) ? v : null);
  if (kind === "columns" || kind === "both") {
    const c = isObj(value.columns) ? value.columns : {};
    const items = Array.isArray(c.items) ? [...new Set(c.items.filter((i): i is string => typeof i === "string" && ITEM_RE.test(i)))].slice(0, 300) : [];
    const height = num(c.height);
    if (height !== null && !(height > 0 && height <= MAX_HEIGHT)) throw new TodoError(400, `Type the height of the pour in metres, e.g. 3.0 (${MAX_HEIGHT} m at most).`);
    out.columns = { floor: floor(c.floor), items, height };
  }
  if (kind === "slab" || kind === "both") {
    const s = isObj(value.slab) ? value.slab : {};
    const thickness = num(s.thickness);
    if (thickness !== null && !(thickness >= 50 && thickness <= 1000)) throw new TodoError(400, "Type the slab's thickness in mm, e.g. 200.");
    out.slab = { floor: floor(s.floor), from: grid(s.from) ?? "", to: grid(s.to) ?? "", rowFrom: grid(s.rowFrom), rowTo: grid(s.rowTo), thickness, beams: s.beams !== false };
  }
  if (kind === "other") {
    const o = isObj(value.other) ? value.other : {};
    const m3 = num(o.m3);
    if (m3 !== null && !(m3 > 0 && m3 <= 2000)) throw new TodoError(400, "Type the m³, e.g. 6.");
    out.other = { what: cleanText(o.what, 80, "pour"), m3: m3 === null ? null : r1(m3), slump: cleanText(o.slump, 20, "slump") };
  }
  return out;
}

/** The estimate as picked on the phone, worked out again here from the building as it is. */
export async function checkEstimate(value: unknown): Promise<{ input: EstimateInput; result: EstimateResult }> {
  const input = cleanInput(value);
  const result = estimate(input, await estimateFloors());
  if (result.problem) throw new TodoError(400, result.problem);
  return { input, result };
}

/* ---------- saved with the pour ---------- */

const estimateId = (pourId: string) => POUR_ESTIMATE_PREFIX + pourId;

export async function saveEstimate(me: TodoMe, pourId: string, est: { input: EstimateInput; result: EstimateResult }): Promise<void> {
  const client = getBuyersClient();
  await client.createIfNotExists({ _id: estimateId(pourId), _type: "pourEstimate", pourId });
  await client
    .patch(estimateId(pourId))
    .set({ inputJson: JSON.stringify(est.input), resultJson: JSON.stringify(est.result), at: new Date().toISOString(), by: me.name })
    .commit();
}

/** The estimate taken off a pour (its order, if any, stays). */
export async function dropEstimate(pourId: string): Promise<void> {
  const client = getBuyersClient();
  const has = await client.fetch<boolean>(`defined(*[_id == $id][0]._id)`, { id: estimateId(pourId) });
  if (has) await client.patch(estimateId(pourId)).unset(["inputJson", "resultJson", "at", "by"]).commit();
}

interface Row {
  pourId: string;
  inputJson?: string | null;
  resultJson?: string | null;
  at?: string | null;
  by?: string | null;
  orderJson?: string | null;
  orderAt?: string | null;
  orderBy?: string | null;
}
const parse = <T>(text: string | null | undefined): T | null => {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};

/** Each listed pour's estimate and order (none: null). */
export async function pourEstimates(pourIds: string[]): Promise<Map<string, { estimate: SavedEstimate | null; order: SavedOrder | null }>> {
  const out = new Map<string, { estimate: SavedEstimate | null; order: SavedOrder | null }>();
  if (!pourIds.length) return out;
  const rows = await getBuyersClient().fetch<Row[]>(
    `*[_type == "pourEstimate" && string::startsWith(_id, $prefix) && pourId in $ids]{ pourId, inputJson, resultJson, at, by, orderJson, orderAt, orderBy }`,
    { prefix: POUR_ESTIMATE_PREFIX, ids: pourIds }
  );
  for (const r of rows) {
    const input = parse<EstimateInput>(r.inputJson);
    const result = parse<EstimateResult>(r.resultJson);
    const order = parse<PourOrder>(r.orderJson);
    out.set(r.pourId, {
      estimate: input && result ? { input, result, at: r.at ?? "", by: r.by ?? "" } : null,
      order: order ? { ...order, sentAt: r.orderAt ?? "", sentBy: r.orderBy ?? "" } : null,
    });
  }
  return out;
}

/** The last order sent: its company, number, first truck, pump and contact start the next one. */
export async function lastOrder(): Promise<Partial<PourOrder> | null> {
  const row = await getBuyersClient().fetch<{ orderJson?: string } | null>(
    `*[_type == "pourEstimate" && string::startsWith(_id, $prefix) && defined(orderJson)] | order(orderAt desc)[0]{ orderJson }`,
    { prefix: POUR_ESTIMATE_PREFIX }
  );
  const o = parse<PourOrder>(row?.orderJson);
  return o ? { supplier: o.supplier, phone: o.phone, time: o.time, pump: o.pump, contact: o.contact } : null;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The order as the phone sent it, checked. */
export function checkOrder(value: unknown): PourOrder {
  if (!isObj(value)) throw new TodoError(400, "The order didn't come through: try again.");
  const phone = typeof value.phone === "string" ? value.phone.trim() : "";
  if (phone && !/^[+\d][\d\s()-]{5,22}$/.test(phone)) throw new TodoError(400, "Type their WhatsApp number in digits, e.g. 024 123 4567.");
  const time = typeof value.time === "string" ? value.time.trim() : "";
  if (time && !TIME_RE.test(time)) throw new TodoError(400, "Pick the time of the first truck.");
  const raw = Array.isArray(value.lines) ? value.lines.slice(0, 6) : [];
  const lines = raw.filter(isObj).map((l) => {
    const m3 = num(l.m3);
    if (m3 === null || !(m3 > 0 && m3 <= 2000)) throw new TodoError(400, "Type the m³ of each part, e.g. 15.");
    return { label: cleanText(l.label, 80, "part's name") || "Concrete", m3: r1(m3), slump: cleanText(l.slump, 20, "slump") };
  });
  if (!lines.length) throw new TodoError(400, "Say how much concrete: type the m³.");
  return {
    supplier: cleanText(value.supplier, 60, "company's name"),
    phone,
    time,
    pump: value.pump === true,
    contact: cleanText(value.contact, 80, "contact"),
    notes: cleanText(value.notes, 400, "note"),
    mix: cleanText(value.mix, 30, "mix"),
    lines,
  };
}

/** The order as sent (or copied) to the concrete company (checked first: checkOrder). */
export async function saveOrderDoc(me: TodoMe, pourId: string, order: PourOrder): Promise<PourOrder> {
  const client = getBuyersClient();
  await client.createIfNotExists({ _id: estimateId(pourId), _type: "pourEstimate", pourId });
  await client
    .patch(estimateId(pourId))
    .set({ orderJson: JSON.stringify(order), orderAt: new Date().toISOString(), orderBy: me.name })
    .commit();
  return order;
}
