import "server-only";

import { writeWithClaude, type JsonSchema } from "@/lib/ai/claude";
import { MAX_FIELD, MAX_VOLUME, tidyTime } from "./shared";

// A truck's waybill, read off its photo (Niko, 30 Oct 2026: "take a photo of and it records automatically all
// the information"). The photo is already in the private store; Claude reads it and answers in a fixed shape,
// and every value is checked here before it goes on the truck. Only empty fields are filled, so nothing the
// site typed is ever overwritten.

export interface WaybillReading {
  readable: boolean;
  supplier: string | null;
  waybillNo: string | null;
  lorry: string | null;
  driver: string | null;
  waybillDate: string | null;
  yardTime: string | null;
  volume: number | null;
  mix: string | null;
  aggregate: string | null;
  additive: string | null;
  notes: string[];
}

const SYSTEM = `You read photos of ready-mix concrete waybills (delivery tickets) for The Lexington, an apartment building under construction in Accra, Ghana. Each concrete truck hands the site a waybill when it arrives; the site photographs it, and your answer fills in that truck's record. The site checks it afterwards.

Rules:
- Read only what the waybill shows. If something isn't on it, or you can't read it with confidence, answer null. Never guess a number, a name, a time or a date.
- supplier: the company that issued it (the batching plant), short, e.g. "Consar".
- waybillNo: the waybill's own printed serial number, digits as printed (keep leading zeros).
- lorry: the truck's number plate as written, e.g. "GR 6556-24".
- driver: the driver's name, in Title Case.
- date: the date written at the top of the waybill, as YYYY-MM-DD. Ghanaian waybills write the day first: 30-10-26 is 30 October 2026.
- time: the time written at the top beside the date (when the truck left the plant), as HH:MM in 24-hour time. Convert when it shows am or pm; otherwise give it as written.
- volume: the concrete on this truck, in cubic metres, as a plain number.
- mix: the mix or strength that is ticked or written for this delivery, e.g. "25 MPa" or "C25". If the label of the ticked line is torn, covered or unreadable, answer null and say so in notes.
- aggregate: the aggregate size marked or written for this delivery, e.g. "10 mm", else null.
- additive: any special additive or requirement written in, else null.
- readable: false when this isn't a concrete waybill or delivery ticket, or can't be read at all.
- notes: anything the site should double-check (a torn or unclear field, a time or date written over, two different dates on it), as one short plain sentence, or null.`;

const nullable = (type: string): JsonSchema => ({ anyOf: [{ type }, { type: "null" }] });

const SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    readable: { type: "boolean" },
    supplier: nullable("string"),
    waybillNo: nullable("string"),
    lorry: nullable("string"),
    driver: nullable("string"),
    date: nullable("string"),
    time: nullable("string"),
    volume: nullable("number"),
    mix: nullable("string"),
    aggregate: nullable("string"),
    additive: nullable("string"),
    notes: nullable("string"),
  },
  required: ["readable", "supplier", "waybillNo", "lorry", "driver", "date", "time", "volume", "mix", "aggregate", "additive", "notes"],
  additionalProperties: false,
};

interface RawReading {
  readable: boolean;
  supplier: string | null;
  waybillNo: string | null;
  lorry: string | null;
  driver: string | null;
  date: string | null;
  time: string | null;
  volume: number | null;
  mix: string | null;
  aggregate: string | null;
  additive: string | null;
  notes: string | null;
}

const MAX_BYTES = 4_500_000;

/** Where a stored photo can be fetched, from its asset id (image-<sha1>-<w>x<h>-<ext>). */
function photoFile(assetId: string): { url: string; type: "image/jpeg" | "image/png" | "image/webp" } | null {
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
  const dataset = process.env.NEXT_PUBLIC_SANITY_BUYERS_DATASET;
  const m = /^image-([a-f0-9]{40})-(\d+x\d+)-(jpg|png|webp)$/.exec(assetId);
  if (!m || !projectId || !dataset) return null;
  return { url: `https://cdn.sanity.io/images/${projectId}/${dataset}/${m[1]}-${m[2]}.${m[3]}`, type: m[3] === "jpg" ? "image/jpeg" : (`image/${m[3]}` as "image/png" | "image/webp") };
}

const text = (value: unknown, max = MAX_FIELD) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) || null : null);

/** Claude's answer, checked against the day the truck came: a date far off or a silly volume becomes "not read". */
function clean(raw: RawReading, day: string): WaybillReading {
  const notes: string[] = [];
  const near = (d: string) => Math.abs(Date.parse(`${d}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) <= 31 * 86_400_000;
  const date = typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) && !Number.isNaN(Date.parse(`${raw.date}T00:00:00Z`)) && near(raw.date) ? raw.date : null;
  if (raw.date && !date) notes.push(`The date read off it (${raw.date}) doesn't look right: check it.`);
  const yardTime = tidyTime(raw.time);
  if (raw.time && !yardTime) notes.push(`The time read off it (${raw.time}) doesn't look right: type it in.`);
  const volume = typeof raw.volume === "number" && Number.isFinite(raw.volume) && raw.volume > 0 && raw.volume <= MAX_VOLUME ? Math.round(raw.volume * 100) / 100 : null;
  if (raw.volume && !volume) notes.push(`The volume read off it (${raw.volume}) doesn't look right: check it.`);
  if (raw.notes) notes.push(raw.notes.trim());
  return {
    readable: raw.readable === true,
    supplier: text(raw.supplier),
    waybillNo: text(raw.waybillNo, 30),
    lorry: text(raw.lorry, 30)?.toUpperCase() ?? null,
    driver: text(raw.driver),
    waybillDate: date,
    yardTime,
    volume,
    mix: text(raw.mix, 40),
    aggregate: text(raw.aggregate, 40),
    additive: text(raw.additive),
    notes: notes.map((n) => n.slice(0, 300)).slice(0, 4),
  };
}

/** Reads one stored waybill photo. Throws a plain-words Error when it can't. */
export async function readWaybill(assetId: string, day: string): Promise<WaybillReading> {
  const file = photoFile(assetId);
  if (!file) throw new Error("The waybill photo isn't stored properly. Take it again.");
  let response = await fetch(file.url, { signal: AbortSignal.timeout(30_000) });
  if (response.status === 404) {
    // Just uploaded: give the image store a moment.
    await new Promise((r) => setTimeout(r, 1500));
    response = await fetch(file.url, { signal: AbortSignal.timeout(30_000) });
  }
  if (!response.ok) throw new Error("The waybill photo couldn't be opened just now.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error("The waybill photo is too big to read.");

  const result = await writeWithClaude<RawReading>({
    system: SYSTEM,
    content: [
      { type: "image", source: { type: "base64", media_type: file.type, data: bytes.toString("base64") } },
      { type: "text", text: `For reference, the truck reached the site on ${day} (give the waybill's own date as written on it). Read this waybill for the truck's record.` },
    ],
    schema: SCHEMA,
    effort: "medium",
    maxTokens: 8000,
    purpose: "waybill reading",
  });
  if (!result.ok) {
    if (/not connected/i.test(result.error)) throw new Error("Reading waybills isn't switched on (no AI key on the website).");
    console.error("[waybill reading]", result.error);
    throw new Error("The waybill couldn't be read just now.");
  }
  return clean(result.value, day);
}
