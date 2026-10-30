import "server-only";
import { createHash } from "node:crypto";
import { after } from "next/server";

import { notifyOwner } from "@/lib/alerts/notify";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { POUR_DAY_PREFIX, TRUCK_PREFIX } from "@/lib/site/ids";
import { ghanaDay } from "@/lib/store/shared";
import { cleanPhotoRef, cleanText, dropPhoto, photoRef, TodoError } from "@/lib/todo/server";
import { photoAt, type TodoMe } from "@/lib/todo/shared";
import { readWaybill, type WaybillReading } from "./readWaybill";
import {
  alertFlags,
  clockOf,
  cubic,
  leftYardAt,
  MAX_COMMENT,
  MAX_FIELD,
  MAX_SLUMP,
  MAX_VOLUME,
  roadMinutes,
  tidyTime,
  truckFlags,
  type ArrivedFrom,
  type ConcreteData,
  type Flag,
  type PourDay,
  type Truck,
} from "./shared";

// The concrete trucks (lib/concrete/shared.ts says what and why). A photo of the waybill makes the truck at
// once, timed by the photo; Claude then reads the waybill in the background and fills in what it says, and
// anything that doesn't add up (a long road time, the same waybill twice, a different mix) goes to the
// office's Alerts. When a site login logged the truck, the office's phone buzzes too; the office's own
// trucks show it on the page right away, so they only get the line in Alerts.

const ID_RE = new RegExp(`^${TRUCK_PREFIX}[a-f0-9]{12}$`);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** The page lists four months of pours. */
const KEEP_DAYS = 120;
/** What Claude reads off a waybill (only empty ones are filled). */
const READ_KEYS = ["supplier", "waybillNo", "lorry", "driver", "waybillDate", "yardTime", "volume", "mix", "aggregate", "additive"] as const;
/** What the page may change by hand: short text fields. */
const TEXT_KEYS = ["supplier", "waybillNo", "lorry", "driver", "mix", "aggregate", "additive"] as const;

const FIELDS = `{
  "id": _id,
  day,
  arrivedAt,
  "arrivedFrom": coalesce(arrivedFrom, "now"),
  "photoUrl": photo.asset->url,
  "reading": coalesce(reading, "done"),
  "readNotes": coalesce(readNotes, []),
  supplier,
  waybillNo,
  lorry,
  driver,
  waybillDate,
  yardTime,
  volume,
  mix,
  aggregate,
  additive,
  slump,
  "cubes": coalesce(cubes, false),
  "comment": coalesce(comment, ""),
  createdAt,
  "createdBy": coalesce(createdBy, ""),
  createdById,
  "updatedAt": _updatedAt
}`;

export async function listConcrete(): Promise<ConcreteData> {
  const from = ghanaDay(Date.now() - KEEP_DAYS * 86_400_000);
  return getBuyersClient().fetch<ConcreteData>(
    `{
      "trucks": *[_type == "concreteTruck" && string::startsWith(_id, $truck) && day >= $from] | order(arrivedAt desc)[0...800] ${FIELDS},
      "days": *[_type == "concreteDay" && string::startsWith(_id, $pourDay) && day >= $from]{ day, "pour": coalesce(pour, ""), "mix": coalesce(mix, ""), "volume": volume }
    }`,
    { truck: TRUCK_PREFIX, pourDay: POUR_DAY_PREFIX, from }
  );
}

export async function getTruck(id: string): Promise<Truck | null> {
  if (!ID_RE.test(id)) return null;
  return getBuyersClient().fetch<Truck | null>(`*[_id == $id && _type == "concreteTruck"][0] ${FIELDS}`, { id });
}

/** The truck's arrival as the phone sent it: the photo's own time when it has one, else when it was added. */
function cleanArrival(value: unknown, from: unknown): { at: string; from: ArrivedFrom } {
  const at = typeof value === "string" ? Date.parse(value) : NaN;
  const now = Date.now();
  if (Number.isFinite(at) && at <= now + 5 * 60_000 && at >= now - 14 * 86_400_000) {
    return { at: new Date(at).toISOString(), from: from === "photo" || from === "file" ? from : "now" };
  }
  return { at: new Date(now).toISOString(), from: "now" };
}

/** A new truck from its waybill photo. The same photo sent twice (no signal for the first answer) is the same truck. */
export async function createTruck(me: TodoMe, body: Record<string, unknown>): Promise<Truck> {
  const photoId = cleanPhotoRef(body.photoId);
  if (!photoId) throw new TodoError(400, "Take a photo of the waybill first.");
  const id = TRUCK_PREFIX + createHash("sha256").update(photoId).digest("hex").slice(0, 12);
  const { at, from } = cleanArrival(body.arrivedAt, body.arrivedFrom);
  try {
    await getBuyersClient().create({
      _id: id,
      _type: "concreteTruck",
      day: ghanaDay(at),
      arrivedAt: at,
      arrivedFrom: from,
      photo: photoRef(photoId),
      reading: "working",
      cubes: false,
      comment: "",
      createdAt: new Date().toISOString(),
      createdBy: me.name,
      createdById: me.id,
    });
    // Once the phone has its answer: Claude reads the waybill, and the office hears if something is off.
    after(() => readAndFill(me, id));
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode !== 409) throw error;
  }
  const truck = await getTruck(id);
  if (!truck) throw new TodoError(502, "It was saved but couldn't be read back. Pull down to refresh.");
  return truck;
}

async function readAndFill(me: TodoMe, id: string): Promise<void> {
  const client = getBuyersClient();
  const doc = await client
    .fetch<(Record<(typeof READ_KEYS)[number], unknown> & { day: string; photo: string | null }) | null>(
      `*[_id == $id && _type == "concreteTruck"][0]{ day, "photo": photo.asset._ref, ${READ_KEYS.join(", ")} }`,
      { id }
    )
    .catch(() => null);
  if (!doc?.photo) return;
  let reading: WaybillReading;
  try {
    reading = await readWaybill(doc.photo, doc.day);
  } catch (error) {
    const why = error instanceof Error ? error.message : "The waybill couldn't be read just now.";
    await client
      .patch(id)
      .set({ reading: "failed", readNotes: [`${why} Tap Read again, or type the details in.`] })
      .commit()
      .catch(() => {});
    return;
  }
  const set: Record<string, unknown> = {
    reading: "done",
    readNotes: reading.readable ? reading.notes : ["This doesn't look like a concrete waybill: check the photo, or type the details in.", ...reading.notes].slice(0, 4),
  };
  // Only what's still empty: anything the site typed meanwhile stays.
  for (const key of READ_KEYS) if ((doc[key] === null || doc[key] === undefined || doc[key] === "") && reading[key] !== null) set[key] = reading[key];
  try {
    await client.patch(id).set(set).commit();
  } catch {
    return; // deleted while it was being read
  }
  await tellTheOffice(me, id, []);
}

/** "45 min from the yard", for an alert's title. */
function headline(flag: Flag, minutes: number | null): string {
  if (flag.kind === "late") return `${minutes} min from the yard`;
  if (flag.kind === "quick") return `only ${minutes} min from the yard`;
  if (flag.kind === "before") return "photo earlier than the waybill's time";
  if (flag.kind === "date") return "waybill from another day";
  if (flag.kind === "twice") return "the same waybill twice";
  return "a different mix";
}

/** The office hears what doesn't add up about a truck (only what's new since `known`). */
async function tellTheOffice(me: TodoMe, id: string, known: Flag["kind"][]): Promise<void> {
  try {
    const all = await listConcrete();
    const t = all.trucks.find((x) => x.id === id);
    if (!t) return;
    const flags = alertFlags(truckFlags(t, all.trucks, all.days.find((d) => d.day === t.day)));
    if (!flags.some((f) => !known.includes(f.kind))) return;
    const minutes = roadMinutes(t);
    const left = leftYardAt(t);
    const open = `/todo/concrete?open=${id}`;
    await notifyOwner({
      kind: "concrete",
      title: `${t.lorry ? `Truck ${t.lorry}` : "A concrete truck"}: ${headline(flags[0], minutes)}`,
      lines: [
        left ? `Left the yard ${clockOf(left)}, on site ${clockOf(t.arrivedAt)}${minutes !== null && minutes >= 0 ? ` (${minutes} min)` : ""}.` : `On site ${clockOf(t.arrivedAt)}.`,
        ...flags.map((f) => f.text),
        [t.volume ? `${cubic(t.volume)} m³` : "", t.mix ?? "", t.waybillNo ? `waybill ${t.waybillNo}` : "", me.kind === "site" ? `logged by ${me.name}` : ""].filter(Boolean).join(" · "),
      ].filter(Boolean),
      links: [{ label: "Open the truck", url: open }],
      urgent: me.kind === "site",
      tag: `concrete-${id}`,
      open,
      image: t.photoUrl ? photoAt(t.photoUrl, 720) : undefined,
    });
  } catch (error) {
    console.error("[concrete] alert failed:", error instanceof Error ? error.message : error);
  }
}

function checkId(id: string) {
  if (!ID_RE.test(id)) throw new TodoError(404, "That truck isn't on the list any more.");
}

const cleanNumber = (value: unknown, max: number, what: string, whole = false): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(n) || n <= 0 || n > max) throw new TodoError(400, `The ${what} doesn't look right.`);
  return whole ? Math.round(n) : Math.round(n * 100) / 100;
};

/** A change made on the page: the waybill's details, the arrival time, the slump, cubes and the comment; or "read" (read the waybill again). */
export async function changeTruck(me: TodoMe, id: string, body: Record<string, unknown>): Promise<Truck> {
  checkId(id);
  const client = getBuyersClient();
  const before = await getTruck(id);
  if (!before) throw new TodoError(404, "That truck isn't on the list any more.");

  if (body.action === "read") {
    if (before.reading === "working") return before;
    await client.patch(id).set({ reading: "working", readNotes: [] }).commit();
    after(() => readAndFill(me, id));
    return (await getTruck(id)) ?? before;
  }

  const set: Record<string, unknown> = {};
  const unset: string[] = [];
  const put = (key: string, value: unknown) => {
    if (value === null || value === "") unset.push(key);
    else set[key] = value;
  };
  for (const key of TEXT_KEYS) if (key in body) put(key, cleanText(body[key], MAX_FIELD, key === "waybillNo" ? "waybill number" : key));
  if ("waybillDate" in body) {
    const d = body.waybillDate;
    if (d !== null && d !== "" && (typeof d !== "string" || !DAY_RE.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`)))) throw new TodoError(400, "Pick the date on the waybill.");
    put("waybillDate", d);
  }
  if ("yardTime" in body) {
    const time = body.yardTime === null || body.yardTime === "" ? null : tidyTime(body.yardTime);
    if (body.yardTime && !time) throw new TodoError(400, "Type the waybill's time like 10:35.");
    put("yardTime", time);
  }
  if ("arrivedTime" in body) {
    const time = tidyTime(body.arrivedTime);
    if (!time) throw new TodoError(400, "Type the arrival time like 10:52.");
    set.arrivedAt = new Date(`${before.day}T${time}:00Z`).toISOString();
    set.arrivedFrom = "typed";
  }
  if ("volume" in body) put("volume", cleanNumber(body.volume, MAX_VOLUME, "volume (m³)"));
  if ("slump" in body) put("slump", cleanNumber(body.slump, MAX_SLUMP, "slump (mm)", true));
  if ("cubes" in body) set.cubes = body.cubes === true;
  if ("comment" in body) set.comment = cleanText(body.comment, MAX_COMMENT, "comment");
  if (!Object.keys(set).length && !unset.length) return before;

  const known = me.kind === "site" ? await listConcrete().then((all) => truckFlags(before, all.trucks, all.days.find((d) => d.day === before.day)).map((f) => f.kind)) : null;
  await client.patch(id).set(set).unset(unset).commit();
  // A site login's change that shows something new (a time typed in that makes the road too long): the office hears.
  if (known) after(() => tellTheOffice(me, id, known));
  const truck = await getTruck(id);
  if (!truck) throw new TodoError(404, "That truck isn't on the list any more.");
  return truck;
}

/** Off the list: the office any truck, a site login the ones it logged. */
export async function deleteTruck(me: TodoMe, id: string): Promise<void> {
  checkId(id);
  const client = getBuyersClient();
  const doc = await client.fetch<{ photo?: string; createdById?: string } | null>(`*[_id == $id && _type == "concreteTruck"][0]{ "photo": photo.asset._ref, createdById }`, { id });
  if (!doc) return;
  if (me.kind !== "admin" && doc.createdById !== me.id) throw new TodoError(403, "Only the office can delete a truck someone else logged.");
  await client.delete(id);
  if (doc.photo) await dropPhoto(doc.photo, "concrete");
}

/** What was poured on a day and what was ordered (each may be left empty). */
export async function setPourDay(body: Record<string, unknown>): Promise<PourDay> {
  const day = body.day;
  if (typeof day !== "string" || !DAY_RE.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) throw new TodoError(400, "Pick the day.");
  const pour = cleanText(body.pour, 120, "pour");
  const mix = cleanText(body.mix, 40, "mix");
  const volume = cleanNumber(body.volume, 2000, "volume ordered (m³)");
  const id = `${POUR_DAY_PREFIX}${day}`;
  const client = getBuyersClient();
  await client.createIfNotExists({ _id: id, _type: "concreteDay", day });
  await client
    .patch(id)
    .set({ pour, mix, ...(volume !== null ? { volume } : {}) })
    .unset(volume === null ? ["volume"] : [])
    .commit();
  return { day, pour, mix, volume };
}
