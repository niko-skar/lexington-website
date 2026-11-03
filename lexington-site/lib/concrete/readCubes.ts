import "server-only";

import { writeWithClaude, type JsonSchema } from "@/lib/ai/claude";

// A laboratory's concrete cube test results, read off its form (Niko, 3 Nov 2026: "a place to put in the results (And
// attach the results form) it should be able to read the results form and fill in the information for me, most
// important being the compressive strength in mPa or what i'm aiming for is c35"). The form is already in the private
// store; Claude reads it and answers in a fixed shape, and every value is checked here before it goes on the test.

export interface CubeReading {
  readable: boolean;
  /** YYYY-MM-DD the cubes were crushed. */
  testedOn: string | null;
  /** The age at test in days, as the form says. */
  ageDays: number | null;
  /** Each cube's compressive strength in MPa (N/mm²), in the form's order. */
  strengths: number[];
  /** The average the form gives (else null: the app averages). */
  averageMPa: number | null;
  /** The grade or target the form names ("C35", "35 N/mm²"), as written. */
  grade: string | null;
  lab: string | null;
  notes: string[];
}

const SYSTEM = `You read concrete cube test result forms (compressive strength test certificates or worksheets) from testing laboratories in Ghana, for The Lexington, an apartment building under construction in Accra. The site attaches the lab's form to the pour's cube test, and your answer fills in that test. The site checks it afterwards.

Rules:
- Read only what the form shows. If something isn't on it, or you can't read it with confidence, answer null (or an empty list). Never guess a number or a date.
- testedOn: the date the cubes were tested (crushed), as YYYY-MM-DD. Ghanaian forms write the day first: 10/11/26 is 10 November 2026.
- ageDays: the age of the cubes at test in days (7, 14, 28...), as written on the form.
- strengths: each cube's compressive strength in MPa (the same as N/mm²), one number per cube, in the order on the form. If the form only gives the crushing load (kN) for 150 mm cubes, divide by 22.5 to get MPa and say so in notes; for other cube sizes leave it out and say so.
- averageMPa: the average (mean) strength the form gives for these cubes, else null.
- grade: the concrete grade or target strength the form names for this pour, as written (e.g. "C35", "35 N/mm²"), else null.
- lab: the laboratory's name, short.
- readable: false when this isn't a concrete cube test form, or can't be read at all.
- notes: anything the site should double-check (a figure written over, cubes of different sizes, a result marked failed), as one short plain sentence, or null.`;

const nullable = (type: string): JsonSchema => ({ anyOf: [{ type }, { type: "null" }] });

const SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    readable: { type: "boolean" },
    testedOn: nullable("string"),
    ageDays: nullable("number"),
    strengths: { type: "array", items: { type: "number" } },
    averageMPa: nullable("number"),
    grade: nullable("string"),
    lab: nullable("string"),
    notes: nullable("string"),
  },
  required: ["readable", "testedOn", "ageDays", "strengths", "averageMPa", "grade", "lab", "notes"],
  additionalProperties: false,
};

interface RawReading {
  readable: boolean;
  testedOn: string | null;
  ageDays: number | null;
  strengths: number[];
  averageMPa: number | null;
  grade: string | null;
  lab: string | null;
  notes: string | null;
}

const MAX_BYTES = 4_500_000;
const okStrength = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 150;
const text = (value: unknown, max = 60) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) || null : null);

/** Claude's answer, checked against the pour: a test date before the pour or far off, or a silly strength, becomes "not read". */
export function cleanCubeReading(raw: RawReading, pouredOn: string): CubeReading {
  const notes: string[] = [];
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`);
  const testedOn =
    typeof raw.testedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.testedOn) && !Number.isNaN(day(raw.testedOn)) && day(raw.testedOn) >= day(pouredOn) && day(raw.testedOn) - day(pouredOn) <= 400 * 86_400_000
      ? raw.testedOn
      : null;
  if (raw.testedOn && !testedOn) notes.push(`The test date read off it (${raw.testedOn}) doesn't fit the pour: check it.`);
  const ageDays = typeof raw.ageDays === "number" && Number.isInteger(raw.ageDays) && raw.ageDays >= 1 && raw.ageDays <= 365 ? raw.ageDays : null;
  const strengths = (Array.isArray(raw.strengths) ? raw.strengths : []).filter(okStrength).map((n) => Math.round(n * 10) / 10).slice(0, 12);
  if ((raw.strengths ?? []).length !== strengths.length) notes.push("Some strengths read off it don't look right: check them.");
  const averageMPa = okStrength(raw.averageMPa) ? Math.round(raw.averageMPa * 10) / 10 : null;
  if (raw.notes) notes.push(raw.notes.trim());
  return {
    readable: raw.readable === true,
    testedOn,
    ageDays,
    strengths,
    averageMPa,
    grade: text(raw.grade, 30),
    lab: text(raw.lab),
    notes: notes.map((n) => n.slice(0, 300)).slice(0, 4),
  };
}

/** Reads one stored results form (a photo or a PDF, by its address). Throws a plain-words Error when it can't. */
export async function readCubeForm(file: { url: string; type: string }, pouredOn: string, ageDays: number): Promise<CubeReading> {
  let response = await fetch(file.url, { signal: AbortSignal.timeout(30_000) });
  if (response.status === 404) {
    // Just uploaded: give the store a moment.
    await new Promise((r) => setTimeout(r, 1500));
    response = await fetch(file.url, { signal: AbortSignal.timeout(30_000) });
  }
  if (!response.ok) throw new Error("The results form couldn't be opened just now.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error("The results form is too big to read: take a photo of it instead.");
  const pdf = file.type === "application/pdf";
  const media = pdf ? "application/pdf" : file.type === "image/png" ? "image/png" : file.type === "image/webp" ? "image/webp" : "image/jpeg";
  const result = await writeWithClaude<RawReading>({
    system: SYSTEM,
    content: [
      pdf
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: bytes.toString("base64") } }
        : { type: "image", source: { type: "base64", media_type: media as "image/jpeg" | "image/png" | "image/webp", data: bytes.toString("base64") } },
      { type: "text", text: `For reference, this pour was cast on ${pouredOn}, and this is meant to be its ${ageDays}-day test. Read the form for the test's record.` },
    ],
    schema: SCHEMA,
    effort: "low",
    maxTokens: 2000,
    purpose: "cube test form",
  });
  if (!result.ok) throw new Error(result.error);
  return cleanCubeReading(result.value, pouredOn);
}
