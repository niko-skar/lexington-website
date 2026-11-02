import "server-only";
import { randomBytes } from "node:crypto";

import { readRollcallRecords, saveRollcallRecord } from "@/lib/rollcall/server";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { POUR_DAY_PREFIX, TRUCK_PREFIX } from "@/lib/site/ids";
import { ghanaDay } from "@/lib/store/shared";
import { cleanText, TodoError } from "@/lib/todo/server";
import type { TodoMe } from "@/lib/todo/shared";
import type { PourBooking, PourCheck, PourInfo, Truck } from "./shared";

// Pours booked on the concrete page (Niko, 2 Nov 2026: "i should be able to book pours into the concrete tab, the
// checklist should be there and then as the waybills come in, that marks that the pour happened and automatically
// starts the curing for that pour"). A booking IS the roll call's pour record ("pours/<id>", before the pour), so
// its checklist can be ticked here or on the roll call. The first waybill on its day marks it poured, and from
// that day it cures like any other pour (the roll call's curing and Payday), with the curing days and amounts as
// they are in the roll call's settings then, exactly as the roll call's own "Poured" button does. What's poured
// and the mix ordered also go on the concrete day, for the trucks' checks.

type Data = Record<string, unknown>;
type Item = { text?: string; n?: number; ok?: boolean; at?: string | null } | null;
interface RcPour {
  what?: string;
  phase?: string;
  planned?: string;
  poured?: string | null;
  start?: string | null;
  days?: number | null;
  worker?: string;
  deleted?: boolean;
  mix?: string;
  volume?: number | null;
  check?: { list?: string; name?: string; items?: Record<string, Item> };
}
interface RcWorker {
  id: string;
  name?: string;
  trade?: string;
  active?: boolean;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const POUR_ID_RE = /^[A-Za-z0-9]{8,40}$/;
const CHECK_KEY_RE = /^[A-Za-z0-9_.-]{1,60}$/;
const isObj = (v: unknown): v is Data => !!v && typeof v === "object" && !Array.isArray(v);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
// The roll call's own ids are 20 letters and digits (its old database's), so a pour booked here looks the same.
const newPourId = () => {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return [...randomBytes(20)].map((b) => abc[b % abc.length]).join("");
};

/** The roll call's pours, checklists, workers and settings as they are now. */
async function rollcallState() {
  const rows = await readRollcallRecords(["pours", "checklists", "workers", "config"]);
  const pours = rows.filter((r) => r.col === "pours").map((r) => ({ id: r.key, p: r.data as RcPour }));
  const checklists = rows
    .filter((r) => r.col === "checklists" && !r.data.deleted && typeof r.data.name === "string" && r.data.name)
    .map((r) => ({ id: r.key, name: String(r.data.name), n: Number(r.data.n) || 0, items: (isObj(r.data.items) ? r.data.items : {}) as Record<string, Item> }))
    .sort((a, b) => a.n - b.n || a.name.localeCompare(b.name));
  const workers = rows.filter((r) => r.col === "workers").map((r) => ({ id: r.key, ...(r.data as Omit<RcWorker, "id">) }));
  const settings = rows.find((r) => r.col === "config" && r.key === "settings")?.data ?? {};
  const rates = isObj(settings.rates) ? settings.rates : {};
  // As the roll call reads them (its curingDays(), curingRate(), curingDryRate(), with its defaults).
  const curing = {
    days: Math.round(Number(settings.curingDays ?? 7)) || 7,
    rate: Number(rates.curing ?? 100) || 0,
    dryFine: Number(rates.curingDry ?? 50) || 0,
  };
  return { pours, checklists, workers, curing };
}
type State = Awaited<ReturnType<typeof rollcallState>>;

/** Who cures, as the roll call picks: active, not a steel bender; Albert, else the masons' foreman, else the first. */
function curers(state: State): Array<{ id: string; name: string }> {
  return state.workers
    .filter((w) => w.active !== false && w.trade !== "steel" && w.name)
    .sort((a, b) => (/foreman/.test(a.trade ?? "") ? -1 : 0) - (/foreman/.test(b.trade ?? "") ? -1 : 0) || String(a.name).localeCompare(String(b.name)))
    .map((w) => ({ id: w.id, name: String(w.name) }));
}
function defaultCurer(state: State): string {
  const list = state.workers.filter((w) => w.active !== false && w.trade !== "steel" && w.name);
  return (list.find((w) => /albert/i.test(String(w.name))) ?? list.find((w) => w.trade === "mforeman") ?? curers(state)[0])?.id ?? "";
}

const checksOf = (p: RcPour): PourCheck[] =>
  Object.entries(p.check?.items ?? {})
    .filter((e): e is [string, NonNullable<Item>] => !!e[1] && !!e[1].text)
    .sort((a, b) => (Number(a[1].n) || 0) - (Number(b[1].n) || 0))
    .map(([key, x]) => ({ key, text: String(x.text), ok: !!x.ok, at: x.ok && x.at ? x.at : null }));

function toBooking(id: string, p: RcPour, state: State): PourBooking {
  const worker = state.workers.find((w) => w.id === p.worker);
  const poured = p.phase === "poured" && p.poured ? p.poured : null;
  return {
    id,
    what: p.what ?? "",
    day: p.planned ?? p.poured ?? "",
    mix: p.mix ?? "",
    volume: typeof p.volume === "number" ? p.volume : null,
    phase: poured ? "poured" : "check",
    poured,
    curingDays: poured ? Number(p.days) || null : null,
    curer: worker?.name ? { id: worker.id, name: worker.name } : null,
    checklist: p.check?.name ?? null,
    checks: checksOf(p),
  };
}

/** The bookings to show: every pour still before its pour, and those poured in the last two weeks. */
export async function listPours(): Promise<PourInfo> {
  const state = await rollcallState();
  const since = addDays(ghanaDay(), -14);
  const pours = state.pours
    .filter(({ p }) => !p.deleted && p.planned && (p.phase === "check" || (p.phase === "poured" && (p.poured ?? "") >= since)))
    .map(({ id, p }) => toBooking(id, p, state))
    .sort((a, b) => a.day.localeCompare(b.day) || a.what.localeCompare(b.what));
  return { pours, checklists: state.checklists.map((c) => ({ id: c.id, name: c.name })), curers: curers(state), curingDays: state.curing.days };
}

/* ---------- the concrete day: what's poured and the mix ordered, from the day's bookings ---------- */

async function syncPourDay(day: string, state?: State): Promise<void> {
  const s = state ?? (await rollcallState());
  const booked = s.pours.filter(({ p }) => !p.deleted && p.planned === day && (p.phase === "check" || p.phase === "poured"));
  const id = `${POUR_DAY_PREFIX}${day}`;
  const client = getBuyersClient();
  const current = await client.fetch<{ fromBookings?: boolean } | null>(`*[_id == $id][0]{ fromBookings }`, { id });
  if (!booked.length) {
    // Bookings that moved away: their words go with them (a day typed in by hand stays as it was).
    if (current?.fromBookings) await client.patch(id).set({ pour: "", mix: "" }).unset(["volume", "fromBookings"]).commit();
    return;
  }
  const pour = booked.map(({ p }) => p.what ?? "").filter(Boolean).join(" + ").slice(0, 120);
  const mixes = [...new Set(booked.map(({ p }) => (p.mix ?? "").trim()).filter(Boolean))];
  const volumes = booked.map(({ p }) => p.volume).filter((v): v is number => typeof v === "number");
  const volume = volumes.length ? Math.round(volumes.reduce((a, b) => a + b, 0) * 10) / 10 : null;
  await client.createIfNotExists({ _id: id, _type: "concreteDay", day });
  await client
    .patch(id)
    .set({ pour, mix: mixes.join(" / ").slice(0, 40), fromBookings: true, ...(volume !== null ? { volume } : {}) })
    .unset(volume === null ? ["volume"] : [])
    .commit();
}

/* ---------- booking, ticking, poured ---------- */

function cleanDay(value: unknown): string {
  if (typeof value !== "string" || !DAY_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new TodoError(400, "Pick the day of the pour.");
  const today = ghanaDay();
  if (value < addDays(today, -14) || value > addDays(today, 120)) throw new TodoError(400, "Pick a day within the next four months.");
  return value;
}
function cleanVolume(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(/,/g, ""));
  if (!(n > 0 && n <= 2000)) throw new TodoError(400, "Type the m³ ordered, e.g. 24.");
  return Math.round(n * 10) / 10;
}
function cleanCurer(value: unknown, state: State): string {
  if (typeof value === "string" && value && curers(state).some((c) => c.id === value)) return value;
  const fallback = defaultCurer(state);
  if (!fallback) throw new TodoError(400, "Add the workers on the roll call first: someone has to cure it.");
  return fallback;
}
function pourOf(state: State, id: unknown): { id: string; p: RcPour } {
  const found = typeof id === "string" && POUR_ID_RE.test(id) ? state.pours.find((x) => x.id === id && !x.p.deleted) : undefined;
  if (!found) throw new TodoError(404, "That pour isn't there any more.");
  return found;
}

/** A pour booked for a day: what, the mix and m³ ordered, its checklist (a copy of one of the roll call's), who cures it. */
export async function bookPour(me: TodoMe, body: Data): Promise<string> {
  const state = await rollcallState();
  const day = cleanDay(body.day);
  const what = cleanText(body.what, 80, "pour");
  if (!what) throw new TodoError(400, "Say what's being poured, e.g. 1st floor slab.");
  const mix = cleanText(body.mix, 30, "mix");
  const volume = cleanVolume(body.volume);
  const worker = cleanCurer(body.curer, state);
  const list = typeof body.checklist === "string" ? state.checklists.find((c) => c.id === body.checklist) : undefined;
  const items: Record<string, Item> = {};
  if (list) {
    Object.entries(list.items)
      .filter((e): e is [string, NonNullable<Item>] => !!e[1] && !!e[1].text)
      .sort((a, b) => (Number(a[1].n) || 0) - (Number(b[1].n) || 0))
      .forEach(([key, x], i) => (items[key] = { text: x.text, n: i + 1, ok: false }));
  }
  const id = newPourId();
  const doc: Data = {
    what,
    phase: "check",
    planned: day,
    check: { list: list?.id ?? "none", name: list?.name ?? "No checklist", items },
    worker,
    dry: {},
    created: new Date().toISOString(),
    mix,
    volume,
  };
  await saveRollcallRecord(me.name, "pours", id, "set", doc);
  const after = { ...state, pours: [...state.pours, { id, p: doc as RcPour }] };
  await syncPourDay(day, after);
  // Booked after the trucks came: it's poured already.
  const trucks = await getBuyersClient().fetch<Array<{ _id: string; pourId?: string | null }>>(
    `*[_type == "concreteTruck" && string::startsWith(_id, $prefix) && day == $day]{ _id, pourId }`,
    { prefix: TRUCK_PREFIX, day }
  );
  if (trucks.length && after.pours.filter(({ p }) => !p.deleted && p.phase === "check" && p.planned === day).length === 1) {
    await markPoured(me.name, after, id, day);
    for (const t of trucks.filter((x) => !x.pourId)) await getBuyersClient().patch(t._id).set({ pourId: id }).commit();
  }
  return id;
}

/** A booking changed while it's still before its pour: what, the day, the mix and m³, who cures it. */
export async function changePour(me: TodoMe, id: unknown, body: Data): Promise<void> {
  const state = await rollcallState();
  const { id: key, p } = pourOf(state, id);
  if (p.phase !== "check") throw new TodoError(409, "It's poured already: change its curing on the roll call.");
  const day = cleanDay(body.day ?? p.planned);
  const what = cleanText(body.what ?? p.what, 80, "pour");
  if (!what) throw new TodoError(400, "Say what's being poured, e.g. 1st floor slab.");
  const change: Data = { what, planned: day, mix: cleanText(body.mix ?? p.mix ?? "", 30, "mix"), volume: cleanVolume(body.volume === undefined ? p.volume : body.volume), worker: cleanCurer(body.curer ?? p.worker, state) };
  await saveRollcallRecord(me.name, "pours", key, "update", change);
  const fresh = await rollcallState();
  await syncPourDay(day, fresh);
  if (p.planned && p.planned !== day) await syncPourDay(p.planned, fresh);
}

/** A check ticked (or unticked) before the pour, as on the roll call: `ok` as tapped (without it, the other way round). */
export async function tickPour(me: TodoMe, id: unknown, checkKey: unknown, okValue?: unknown): Promise<void> {
  const state = await rollcallState();
  const { id: key, p } = pourOf(state, id);
  if (p.phase !== "check") throw new TodoError(409, "It's poured already.");
  const item = typeof checkKey === "string" && CHECK_KEY_RE.test(checkKey) ? p.check?.items?.[checkKey] : null;
  if (!item) throw new TodoError(404, "That check isn't on this pour any more.");
  const ok = typeof okValue === "boolean" ? okValue : !item.ok;
  await saveRollcallRecord(me.name, "pours", key, "update", { check: { items: { [checkKey as string]: ok ? { ok: true, at: new Date().toISOString() } : { ok: false, at: null } } } });
}

/** A booking taken off (only before its pour; after it, on the roll call). */
export async function deletePour(me: TodoMe, id: unknown): Promise<void> {
  const state = await rollcallState();
  const { id: key, p } = pourOf(state, id);
  if (p.phase !== "check") throw new TodoError(409, "It's poured already: take it off on the roll call if it never happened.");
  await saveRollcallRecord(me.name, "pours", key, "update", { deleted: true });
  if (p.planned) await syncPourDay(p.planned);
}

/** Poured on a day: from then on it cures like any other pour, as the roll call's own "Poured" button does. */
async function markPoured(by: string, state: State, id: string, day: string): Promise<void> {
  const found = state.pours.find((x) => x.id === id);
  if (!found || found.p.phase !== "check") return;
  const worker = found.p.worker && curers(state).some((c) => c.id === found.p.worker) ? found.p.worker : defaultCurer(state);
  await saveRollcallRecord(by, "pours", id, "update", {
    phase: "poured",
    poured: day,
    start: day,
    days: state.curing.days,
    rate: state.curing.rate,
    dryFine: state.curing.dryFine,
    worker,
  });
}

/** "Poured" by hand (a pour with no trucks: mixed on site), on its booked day or the day given. */
export async function pourDone(me: TodoMe, id: unknown, dayValue: unknown): Promise<void> {
  const state = await rollcallState();
  const { id: key, p } = pourOf(state, id);
  if (p.phase !== "check") return;
  const day = dayValue === undefined ? (p.planned ?? ghanaDay()) : cleanDay(dayValue);
  await markPoured(me.name, state, key, day);
  if (p.planned !== day) await saveRollcallRecord(me.name, "pours", key, "update", { planned: day });
}

/**
 * A truck arrived (its waybill photo): the day's booked pour is poured, and its curing starts that day. With two
 * pours booked that day the truck says which (on its sheet); with none, nothing changes.
 */
export async function truckArrived(me: TodoMe, truck: Pick<Truck, "id" | "day" | "pourId">): Promise<string | null> {
  if (truck.pourId) return truck.pourId;
  const state = await rollcallState();
  const booked = state.pours.filter(({ p }) => !p.deleted && p.planned === truck.day && (p.phase === "check" || p.phase === "poured"));
  if (booked.length !== 1) return null;
  const { id } = booked[0];
  await markPoured(me.name, state, id, truck.day);
  await getBuyersClient().patch(truck.id).set({ pourId: id }).commit();
  return id;
}

/** The truck's sheet: which of the day's pours it brought (that pour is poured). */
export async function setTruckPour(me: TodoMe, truck: Pick<Truck, "id" | "day">, pourId: unknown): Promise<void> {
  const state = await rollcallState();
  const { id } = pourOf(state, pourId);
  await markPoured(me.name, state, id, truck.day);
  await getBuyersClient().patch(truck.id).set({ pourId: id }).commit();
}

/** A truck deleted (logged by mistake): if it was the only one that poured its pour, the pour is back before its pour. */
export async function truckGone(me: TodoMe, truck: Pick<Truck, "id" | "day" | "pourId">): Promise<void> {
  if (!truck.pourId) return;
  const others = await getBuyersClient().fetch<number>(`count(*[_type == "concreteTruck" && string::startsWith(_id, $prefix) && pourId == $pour && _id != $id])`, {
    prefix: TRUCK_PREFIX,
    pour: truck.pourId,
    id: truck.id,
  });
  if (others > 0) return;
  const state = await rollcallState();
  const found = state.pours.find((x) => x.id === truck.pourId);
  if (!found || found.p.phase !== "poured" || found.p.poured !== truck.day) return;
  await saveRollcallRecord(me.name, "pours", found.id, "update", { phase: "check", poured: null, start: null, days: null });
}
