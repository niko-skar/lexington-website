import "server-only";
import { after } from "next/server";

import { del, issueSignedToken, presignUrl } from "@vercel/blob";

import { notifyOwner } from "@/lib/alerts/notify";
import { readRollcallRecords } from "@/lib/rollcall/server";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { newId, POUR_CUBES_PREFIX, POUR_PHOTO_PREFIX } from "@/lib/site/ids";
import { ghanaDay } from "@/lib/store/shared";
import { cleanPhotoRef, dropPhoto, photoRef, TodoError } from "@/lib/todo/server";
import type { TodoMe } from "@/lib/todo/shared";
import { addDays, average, CUBE_AGES, DEFAULT_TARGET_MPA, isPhotoKind, type CubeTest, type PourCubes, type PourPhoto } from "./pourExtras";
import { readCubeForm } from "./readCubes";

// A pour's pre-pour photos and its concrete cubes (lib/concrete/pourExtras.ts says what and why). The photos'
// originals are in the private photo store (Vercel Blob, "pours/<pour>/..."), uploaded by the phone straight there at
// full size; a smaller copy is in the image store to look at. The cubes: how many were taken, and each test's results
// (typed, or read off the lab's form). Each pour's are their own records, so the roll call's pour record is untouched.

type Data = Record<string, unknown>;
const POUR_ID_RE = /^[A-Za-z0-9]{8,40}$/;
const FORM_ID_RE = /^(image-[a-f0-9]{40}-\d+x\d+-(jpg|png|webp)|file-[a-f0-9]{40}-pdf)$/;

/** The pour, as the roll call has it: what it is and the day it was poured (null before). */
async function pourOf(id: unknown): Promise<{ id: string; what: string; poured: string | null; planned: string | null }> {
  if (typeof id !== "string" || !POUR_ID_RE.test(id)) throw new TodoError(404, "That pour isn't there any more.");
  const rows = await readRollcallRecords(["pours"]);
  const row = rows.find((r) => r.col === "pours" && r.key === id && !(r.data as Data).deleted);
  if (!row) throw new TodoError(404, "That pour isn't there any more.");
  const p = row.data as { what?: string; phase?: string; poured?: string | null; planned?: string };
  return { id, what: p.what ?? "", poured: p.phase === "poured" ? (p.poured ?? null) : null, planned: p.planned ?? null };
}

/* ---------- pre-pour photos ---------- */

const PHOTO_FIELDS = `{
  "id": _id, pourId, kind, "previewUrl": preview.asset->url, "width": original.width, "height": original.height, "bytes": original.bytes,
  takenAt, at, "by": coalesce(by, "")
}`;

/** The photos of these pours, as they were taken. */
export async function pourPhotos(pourIds: string[]): Promise<PourPhoto[]> {
  if (!pourIds.length) return [];
  return getBuyersClient().fetch<PourPhoto[]>(`*[_type == "pourPhoto" && string::startsWith(_id, $prefix) && pourId in $ids] | order(takenAt asc) ${PHOTO_FIELDS}`, {
    prefix: POUR_PHOTO_PREFIX,
    ids: pourIds,
  });
}

/** The private photo store's address for a pour's photo, as the phone uploaded it (it starts the pathname). */
export const photoPathOk = (pathname: unknown, pourId: string) => typeof pathname === "string" && pathname.startsWith(`pours/${pourId}/`) && pathname.length < 300;

/** A photo uploaded (its original to the photo store, its copy to the image store): on the pour. Anyone who opens Concrete. */
export async function addPourPhoto(me: TodoMe, body: Data): Promise<void> {
  const pour = await pourOf(body.pourId);
  if (!isPhotoKind(body.kind)) throw new TodoError(400, "Say what the photo shows: steel, pipes or other.");
  const previewId = cleanPhotoRef(body.previewId);
  if (!previewId || previewId.startsWith("pending:")) throw new TodoError(400, "The photo didn't upload properly. Add it again.");
  const original = (body.original ?? {}) as Data;
  if (!photoPathOk(original.pathname, pour.id) || typeof original.url !== "string" || !/^https:\/\/[a-z0-9.-]+\.blob\.vercel-storage\.com\//.test(original.url)) {
    throw new TodoError(400, "The full-size photo didn't upload properly. Add it again.");
  }
  const num = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max ? Math.round(v) : null);
  const taken = typeof body.takenAt === "string" ? Date.parse(body.takenAt) : NaN;
  const now = Date.now();
  const takenAt = Number.isFinite(taken) && taken <= now + 5 * 60_000 && taken >= now - 400 * 86_400_000 ? new Date(taken).toISOString() : new Date(now).toISOString();
  await getBuyersClient().create({
    _id: newId(POUR_PHOTO_PREFIX),
    _type: "pourPhoto",
    pourId: pour.id,
    kind: body.kind,
    preview: photoRef(previewId),
    original: { url: original.url, pathname: original.pathname, bytes: num(original.bytes, 200_000_000), width: num(original.width, 20_000), height: num(original.height, 20_000) },
    takenAt,
    at: new Date(now).toISOString(),
    by: me.name,
    byId: me.id,
  });
}

/** A photo taken off a pour (the office, or whoever added it): its copy and its original go too. */
export async function deletePourPhoto(me: TodoMe, id: unknown): Promise<void> {
  if (typeof id !== "string" || !id.startsWith(POUR_PHOTO_PREFIX)) throw new TodoError(404, "That photo isn't there any more.");
  const client = getBuyersClient();
  const doc = await client.fetch<{ byId?: string; preview?: string; url?: string } | null>(`*[_id == $id && _type == "pourPhoto"][0]{ byId, "preview": preview.asset._ref, "url": original.url }`, { id });
  if (!doc) return;
  if (me.kind !== "admin" && doc.byId !== me.id) throw new TodoError(403, "Only the office can take off a photo someone else added.");
  await client.delete(id);
  if (doc.preview) await dropPhoto(doc.preview, "concrete");
  if (doc.url) await del(doc.url).catch((error) => console.error("[pour photos] the original stayed:", error instanceof Error ? error.message : error));
}

/** A short-lived link to a photo's original at full size (the store is private: the link lasts an hour). */
export async function originalLink(id: string): Promise<string> {
  if (!id.startsWith(POUR_PHOTO_PREFIX)) throw new TodoError(404, "That photo isn't there any more.");
  const pathname = await getBuyersClient().fetch<string | null>(`*[_id == $id && _type == "pourPhoto"][0].original.pathname`, { id });
  if (!pathname) throw new TodoError(404, "That photo isn't there any more.");
  const token = await issueSignedToken({ pathname, operations: ["get"], validUntil: Date.now() + 3600_000 });
  const { presignedUrl } = await presignUrl(token, { operation: "get", pathname, access: "private" });
  return presignedUrl;
}

/* ---------- concrete cubes ---------- */

type RawTest = { _key: string; age: number; testedOn?: string | null; strengths?: number[] | null; average?: number | null; formUrl?: string | null; formType?: string | null; formId?: string | null; reading?: CubeTest["reading"]; readNote?: string | null; at?: string | null; by?: string | null };
const CUBE_FIELDS = `{ pourId, taken, takenAt, "target": coalesce(target, ${DEFAULT_TARGET_MPA}), "tests": coalesce(tests[]{ _key, age, testedOn, strengths, average, "formUrl": form.asset->url, "formType": form.asset->mimeType, "formId": form.asset._ref, reading, readNote, at, by }, []) }`;

/** A pour's cubes as they stand: every test age, due from the day it was poured. */
function toCubes(raw: { pourId: string; taken: number | null; takenAt: string | null; target: number; tests: RawTest[] } | null, pourId: string, poured: string | null): PourCubes {
  const tests = CUBE_AGES.map((age) => {
    const t = raw?.tests.find((x) => x.age === age);
    return {
      age,
      due: poured ? addDays(poured, age) : "",
      testedOn: t?.testedOn ?? null,
      strengths: t?.strengths ?? [],
      average: t?.average ?? null,
      form: t?.formUrl && t.formId ? { url: t.formUrl, type: t.formType ?? "image/jpeg", id: t.formId } : null,
      reading: t?.reading ?? null,
      readNote: t?.readNote ?? null,
      at: t?.at ?? null,
      by: t?.by ?? null,
    };
  });
  return { pourId, taken: raw?.taken ?? null, takenAt: raw?.takenAt ?? null, target: raw?.target ?? DEFAULT_TARGET_MPA, tests };
}

/** The cubes of these pours (each pour's day decides when its tests are due). */
export async function pourCubes(pours: Array<{ id: string; poured: string | null }>): Promise<PourCubes[]> {
  if (!pours.length) return [];
  const rows = await getBuyersClient().fetch<Array<{ pourId: string; taken: number | null; takenAt: string | null; target: number; tests: RawTest[] }>>(
    `*[_type == "pourCubes" && string::startsWith(_id, $prefix) && pourId in $ids] ${CUBE_FIELDS}`,
    { prefix: POUR_CUBES_PREFIX, ids: pours.map((p) => p.id) }
  );
  return pours.map((p) => toCubes(rows.find((r) => r.pourId === p.id) ?? null, p.id, p.poured));
}

const cubesId = (pourId: string) => POUR_CUBES_PREFIX + pourId;

/** How many cubes were taken (and, changeable, what strength the mix aims for). Anyone who opens Concrete. */
export async function setCubes(me: TodoMe, body: Data): Promise<void> {
  const pour = await pourOf(body.pourId);
  const set: Data = {};
  if ("taken" in body) {
    const n = Number(body.taken);
    if (!Number.isInteger(n) || n < 0 || n > 60) throw new TodoError(400, "Say how many cubes were taken, e.g. 6.");
    set.taken = n;
    set.takenAt = new Date().toISOString();
    set.takenBy = me.name;
  }
  if ("target" in body) {
    const t = Number(body.target);
    if (!(t >= 5 && t <= 100)) throw new TodoError(400, "Type the strength it aims for in MPa, e.g. 35.");
    set.target = Math.round(t * 10) / 10;
  }
  if (!Object.keys(set).length) return;
  const client = getBuyersClient();
  await client.createIfNotExists({ _id: cubesId(pour.id), _type: "pourCubes", pourId: pour.id, tests: [] });
  await client.patch(cubesId(pour.id)).set(set).commit();
}

function cleanStrengths(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out = value.map((v) => Number(String(v).replace(",", "."))).filter((n) => Number.isFinite(n) && n > 0);
  if (out.some((n) => n > 150)) throw new TodoError(400, "A cube's strength is in MPa (N/mm²), e.g. 36.5.");
  if (out.length > 12) throw new TodoError(400, "12 cubes at most in one test.");
  return out.map((n) => Math.round(n * 10) / 10);
}

/** One test's record: the day it was crushed and each cube's strength (typed, or as read off the form and checked). */
export async function setCubeResult(me: TodoMe, body: Data): Promise<void> {
  const pour = await pourOf(body.pourId);
  const age = Number(body.age);
  if (!(CUBE_AGES as readonly number[]).includes(age)) throw new TodoError(400, "Pick the test: 7, 14 or 28 days.");
  const testedOn = body.testedOn === null || body.testedOn === "" || body.testedOn === undefined ? null : String(body.testedOn);
  if (testedOn && (!/^\d{4}-\d{2}-\d{2}$/.test(testedOn) || (pour.poured && testedOn < pour.poured) || testedOn > ghanaDay())) throw new TodoError(400, "Pick the day the cubes were tested.");
  const strengths = cleanStrengths(body.strengths);
  await saveTest(pour.id, age, { testedOn, strengths, average: average(strengths), at: new Date().toISOString(), by: me.name });
}

/** The test's record as it changes, kept under its age (made when first needed). */
async function saveTest(pourId: string, age: number, change: Data): Promise<void> {
  const client = getBuyersClient();
  const id = cubesId(pourId);
  await client.createIfNotExists({ _id: id, _type: "pourCubes", pourId, tests: [] });
  const has = await client.fetch<boolean>(`count(*[_id == $id][0].tests[age == $age]) > 0`, { id, age });
  if (!has) await client.patch(id).setIfMissing({ tests: [] }).append("tests", [{ _key: `a${age}`, age }]).commit();
  const set: Data = {};
  for (const [k, v] of Object.entries(change)) set[`tests[_key=="a${age}"].${k}`] = v;
  await client.patch(id).set(set).commit();
}

/**
 * The lab's results form attached to a test (a photo or a PDF, already in the image store): read, it fills in the
 * test's day and the cubes' strengths, unless they were typed already.
 */
export async function attachCubeForm(me: TodoMe, body: Data): Promise<void> {
  const pour = await pourOf(body.pourId);
  const age = Number(body.age);
  if (!(CUBE_AGES as readonly number[]).includes(age)) throw new TodoError(400, "Pick the test: 7, 14 or 28 days.");
  const formId = typeof body.formId === "string" && FORM_ID_RE.test(body.formId) ? body.formId : null;
  if (!formId) throw new TodoError(400, "The results form didn't upload properly. Add it again.");
  const ref = { _type: formId.startsWith("file-") ? "file" : "image", asset: { _type: "reference", _ref: formId } };
  await saveTest(pour.id, age, { form: ref, reading: "working", readNote: null, at: new Date().toISOString(), by: me.name });
  after(() => readForm(pour.id, pour.poured ?? pour.planned ?? ghanaDay(), age, formId));
}

/** Reads a test's form and fills what's still empty. Never throws: a failure is noted on the test. */
async function readForm(pourId: string, pouredOn: string, age: number, formId: string): Promise<void> {
  const client = getBuyersClient();
  try {
    const file = await client.fetch<{ url: string; type: string } | null>(`*[_id == $id][0]{ url, "type": mimeType }`, { id: formId });
    if (!file?.url) throw new Error("The results form isn't stored properly. Add it again.");
    const r = await readCubeForm({ url: file.url, type: file.type || "image/jpeg" }, pouredOn, age);
    const now = await client.fetch<RawTest | null>(`*[_id == $id][0].tests[_key == $key][0]{ testedOn, strengths, average, "formId": form.asset._ref }`, { id: cubesId(pourId), key: `a${age}` });
    // Replaced by another form meanwhile: that one's reading counts.
    if (now?.formId !== formId) return;
    if (!r.readable) {
      await saveTest(pourId, age, { reading: "failed", readNote: ["The app couldn't read this as cube results: type them in.", ...r.notes].join(" ").slice(0, 400) });
      return;
    }
    const fill: Data = { reading: "done" };
    const filled: string[] = [];
    if (!now?.testedOn && r.testedOn) {
      fill.testedOn = r.testedOn;
      filled.push("the test day");
    }
    if (!now?.strengths?.length && r.strengths.length) {
      fill.strengths = r.strengths;
      fill.average = r.averageMPa ?? average(r.strengths);
      filled.push(`${r.strengths.length} cube ${r.strengths.length === 1 ? "strength" : "strengths"}`);
    }
    if (r.ageDays && r.ageDays !== age) r.notes.unshift(`The form says these are ${r.ageDays}-day cubes.`);
    fill.readNote = [filled.length ? `Read off the form: ${filled.join(" and ")}. Check them.` : "Read the form: the results were already typed in.", ...r.notes].join(" ").slice(0, 400);
    await saveTest(pourId, age, fill);
  } catch (error) {
    await saveTest(pourId, age, { reading: "failed", readNote: `${error instanceof Error ? error.message : "The form couldn't be read."} Type the results in.`.slice(0, 400) }).catch(() => {});
  }
}

/* ---------- reminders ---------- */

/**
 * Every morning (the 7:00 run): a test due today, or two days late without its results, buzzes the office's phone.
 * Only pours whose cubes were taken; a test with its results never does.
 */
export async function cubeReminders(today = ghanaDay()): Promise<{ sent: number }> {
  const rows = await readRollcallRecords(["pours"]);
  const poured = rows
    .filter((r) => r.col === "pours" && !(r.data as Data).deleted && (r.data as Data).phase === "poured" && typeof (r.data as Data).poured === "string")
    .map((r) => ({ id: r.key, what: String((r.data as Data).what ?? "a pour"), poured: String((r.data as Data).poured) }))
    .filter((p) => p.poured >= addDays(today, -35));
  const cubes = await pourCubes(poured);
  let sent = 0;
  for (const c of cubes) {
    if (!c.taken) continue;
    const pour = poured.find((p) => p.id === c.pourId)!;
    for (const t of c.tests) {
      if (t.average !== null) continue;
      const late = t.due === addDays(today, -2);
      if (t.due !== today && !late) continue;
      await notifyOwner({
        kind: "concrete",
        title: late ? `Cube test 2 days late: ${t.age} days` : `Cube test due today: ${t.age} days`,
        lines: [`${pour.what}, poured ${pour.poured}`, `${c.taken} cubes taken · aiming for ${c.target} MPa`, "Add the results (and the lab's form) on the Concrete page."],
        links: [{ label: "Open Concrete", url: "/todo/concrete" }],
        urgent: true,
        tag: `cubes-${c.pourId}-${t.age}`,
        open: "/todo/concrete",
      });
      sent++;
    }
  }
  return { sent };
}

