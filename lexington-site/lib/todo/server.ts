import "server-only";
import { randomBytes, randomInt } from "node:crypto";
import { after } from "next/server";

import { clip, notifyOwner, pushToPeople } from "@/lib/alerts/notify";
import { hashPassword } from "@/lib/auth/password";
import { getAdminSession, getBuyerSession, renewAppSession } from "@/lib/auth/session";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { PHOTO_TICKET_PREFIX } from "@/lib/site/ids";
import {
  areaLabel,
  AREAS,
  MAX_NOTE,
  MAX_TEXT,
  photoAt,
  SECTIONS,
  SITE_SECTIONS,
  type Section,
  type SiteAccount,
  type SiteSection,
  type TodoMe,
  type TodoTask,
} from "./shared";

// Items live in the PRIVATE buyers dataset, never the public website one: the public dataset
// can be listed by anyone, photos included. Live items are "sitetask-live-<12 hex>"; a preview
// build or a laptop writes "sitetask-dev-..." so testing never mixes into the real list.
const LIVE = process.env.VERCEL_ENV === "production";
const PREFIX = LIVE ? "sitetask-live-" : "sitetask-dev-";
const ID_RE = LIVE ? /^sitetask-live-[a-f0-9]{12}$/ : /^sitetask-dev-[a-f0-9]{12}$/;
// Sanity image asset ids: image-<sha1>-<width>x<height>-<format>
const PHOTO_ID_RE = /^image-[a-f0-9]{40}-\d+x\d+-(jpg|png|webp)$/;
// A supplier's bill can be a PDF too (Niko, 4 Nov 2026: "i need to be able to upload pdfs"): file-<sha1>-pdf.
const PDF_ID_RE = /^file-[a-f0-9]{40}-pdf$/;
// A photo still uploading when its record was saved: "pending:" and the phone's ticket for it (components/todo/photoQueue.ts).
const TICKET_RE = /^[a-f0-9]{24}$/;
const PENDING_RE = /^pending:([a-f0-9]{24})$/;

export class TodoError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

/* ---------- who is signed in ---------- */

type Account = { _id: string; email: string; name?: string; role?: string; siteAccess?: unknown };
const accounts = new Map<string, { at: number; account: Account | null }>();

// The list refreshes every few seconds; looking the account up each time would double the
// requests, so a minute-old answer is fine (removing a foreman's access takes effect within it).
async function accountFor(email: string): Promise<Account | null> {
  const hit = accounts.get(email);
  if (hit && Date.now() - hit.at < 60_000) return hit.account;
  const account = await getBuyersClient().fetch<Account | null>(
    `*[_type == "buyerAccount" && lower(email) == $email][0]{ _id, email, name, role, siteAccess }`,
    { email }
  );
  accounts.set(email, { at: Date.now(), account });
  return account;
}

/** What a site login opens. Logins made before the store existed (the foreman's) have the to-do list and
 *  the store: Niko, 22 Oct 2026: "albert and I can record materials going out". Never the roll call or
 *  Payday unless the office ticks them. */
function siteSections(value: unknown): SiteSection[] {
  if (!Array.isArray(value)) return ["todo", "store"];
  return SITE_SECTIONS.filter((s) => value.includes(s));
}

/**
 * Admins (Niko's account, or the office password) and "site" accounts (the foreman, a storekeeper). Using the app keeps
 * them signed in (keepSignedIn; a page being drawn can't, the app's next request does).
 */
export async function getTodoUser(): Promise<TodoMe | null> {
  const me = await signedIn();
  if (me) await keepSignedIn();
  return me;
}

async function signedIn(): Promise<TodoMe | null> {
  const buyer = await getBuyerSession();
  if (buyer?.isAdmin) {
    const account = await accountFor(buyer.email);
    if (account?.role === "admin") return { kind: "admin", id: "office", name: account.name?.trim() || "Admin", sections: [...SECTIONS] };
  }
  if (await getAdminSession()) return { kind: "admin", id: "office", name: "Admin", sections: [...SECTIONS] };
  if (buyer?.site) {
    const account = await accountFor(buyer.email);
    if (account?.role === "site") {
      return { kind: "site", id: account._id, name: account.name?.trim() || "Foreman", sections: siteSections(account.siteAccess) };
    }
  }
  return null;
}

/** The signed-in person, if they may open this part of the app (and do office-only things when asked). */
export async function requireTodoUser(adminOnly = false, section: Section = "todo"): Promise<TodoMe> {
  const me = await getTodoUser();
  if (!me) throw new TodoError(401, "You've been signed out. Open the app again to sign in.");
  if (adminOnly && me.kind !== "admin") throw new TodoError(403, "Only the office can do that.");
  if (!me.sections.includes(section)) throw new TodoError(403, "This login can't open that part of the app. Ask the office.");
  return me;
}

/**
 * Using the app keeps them signed in: 30 days from now again (5 Nov 2026). An account's login only while the account is
 * still what the login says (an admin's, a site login's): one the office changed runs out instead.
 */
async function keepSignedIn(): Promise<void> {
  const buyer = await getBuyerSession();
  const account = buyer ? await accountFor(buyer.email) : null;
  const still = !!buyer && !!account && ((buyer.isAdmin && account.role === "admin") || (buyer.site && account.role === "site"));
  await renewAppSession({ buyer: still });
}

/* ---------- the list ---------- */

const FIELDS = `{
  "id": _id,
  "list": coalesce(list, "site"),
  "text": coalesce(text, ""),
  "area": area,
  "urgent": coalesce(urgent, false),
  "status": coalesce(status, "open"),
  createdAt,
  "createdBy": coalesce(createdBy, ""),
  "createdById": createdById,
  "photoUrl": photo.asset->url,
  "doneAt": doneAt,
  "doneBy": doneBy,
  "doneNote": doneNote,
  "fixUrl": donePhoto.asset->url,
  "updatedAt": _updatedAt
}`;

/** The office gets both lists; a site login (the foreman) only ever gets the site list. */
export async function listTasks(me: TodoMe): Promise<TodoTask[]> {
  return getBuyersClient().fetch<TodoTask[]>(
    `*[_type == "siteTask" && string::startsWith(_id, $prefix) && ($all || coalesce(list, "site") == "site")] | order(createdAt desc)[0...800] ${FIELDS}`,
    { prefix: PREFIX, all: me.kind === "admin" }
  );
}

async function getTask(id: string): Promise<TodoTask | null> {
  return getBuyersClient().fetch<TodoTask | null>(`*[_id == $id && _type == "siteTask"][0] ${FIELDS}`, { id });
}

/**
 * A photo on a record. "pending:<ticket>" is one still on its way from the phone (Niko, 3 Nov 2026: "it should load
 * fast in my phone and upload in the background"): the record keeps a marker, and the photo takes its place when it
 * lands (attachPending), whichever comes first.
 */
export const photoRef = (assetId: string) => {
  const pending = PENDING_RE.exec(assetId);
  if (!pending) return { _type: PDF_ID_RE.test(assetId) ? "file" : "image", asset: { _type: "reference", _ref: assetId } };
  try {
    // It may have landed while this record was being written: look again once it's saved.
    after(() => attachPending(pending[1]));
  } catch {
    // Outside a request (a script): the photo puts itself on the record when it lands.
  }
  return { _type: "image", pending: pending[1] };
};

export function cleanText(value: unknown, max: number, what: string) {
  const text = typeof value === "string" ? value.replace(/\s+\n/g, "\n").trim() : "";
  if (text.length > max) throw new TodoError(400, `The ${what} is too long (${max} letters at most).`);
  return text;
}
function cleanArea(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !(AREAS as readonly string[]).includes(value)) throw new TodoError(400, "Pick a floor from the list.");
  return value;
}
function cleanPhotoId(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !PHOTO_ID_RE.test(value)) throw new TodoError(400, "That photo didn't upload properly. Take it again.");
  return value;
}
function checkId(id: string) {
  if (!ID_RE.test(id)) throw new TodoError(404, "That item isn't on the list any more.");
}

export async function createTask(me: TodoMe, body: Record<string, unknown>): Promise<TodoTask> {
  const text = cleanText(body.text, MAX_TEXT, "note");
  const photoId = cleanPhotoId(body.photoId);
  if (!text && !photoId) throw new TodoError(400, "Add a photo or write what needs doing.");
  const id = PREFIX + randomBytes(6).toString("hex");
  await getBuyersClient().create({
    _id: id,
    _type: "siteTask",
    // A site login (the foreman) adds to the site list only; the house list is the office's.
    list: me.kind === "admin" && body.list === "house" ? "house" : "site",
    text,
    area: cleanArea(body.area),
    urgent: body.urgent === true,
    status: "open",
    createdAt: new Date().toISOString(),
    createdBy: me.name,
    createdById: me.id,
    ...(photoId ? { photo: photoRef(photoId) } : {}),
  });
  const task = await getTask(id);
  if (!task) throw new TodoError(502, "It was saved but couldn't be read back. Pull down to refresh.");
  // Once the phone has its answer: the other side hears about the new job.
  after(() => tellTheOtherSide(me, task));
  return task;
}

/* ---------- a new job reaches the other side's phone ---------- */

// Niko, 27 Oct 2026: "i need a notification if albert adds anything to the to do list, same for
// him to get notifications from me". A job a site login adds lands in the office's Alerts and
// buzzes the office's phones; a site job the office adds buzzes the phones of the site logins that
// open the to-do list. House jobs stay the office's own. A tap opens the job itself.
const firstName = (name: string) => name.trim().split(/\s+/)[0] || "Someone";
/** The job in one line for a phone alert: its note, or that it's only a photo. */
const jobLine = (task: TodoTask) => (task.text ? clip(task.text.replace(/\s+/g, " "), 200) : "A photo, no note.");

async function tellTheOtherSide(me: TodoMe, task: TodoTask): Promise<void> {
  if (task.list !== "site") return;
  try {
    // The office password signs in as "Admin": that's the office.
    const who = me.kind === "admin" && me.name === "Admin" ? "The office" : firstName(me.name);
    const title = `${who} added ${task.urgent ? "an urgent job" : "a job"}`;
    const what = jobLine(task);
    const where = task.area ? areaLabel(task.area) : null;
    const open = `/todo/jobs?open=${task.id}`;
    const image = task.photoUrl ? photoAt(task.photoUrl, 720) : undefined;
    if (me.kind === "site") {
      await notifyOwner({
        kind: "todo",
        title,
        lines: where ? [what, where] : [what],
        links: [{ label: "Open the job", url: open }],
        urgent: true,
        tag: `todo-${task.id}`,
        open,
        image,
      });
      return;
    }
    const people = (await listSiteAccounts()).filter((a) => a.sections.includes("todo")).map((a) => a.id);
    await pushToPeople(people, { title, body: where ? `${what}\n${where}` : what, url: open, tag: `todo-${task.id}`, ...(image ? { image } : {}) });
  } catch (error) {
    console.error("[todo] new-job alert failed:", error instanceof Error ? error.message : error);
  }
}

// Niko, 27 Oct 2026: "also notify me when albert ticks a job done". The app offers Undo for a few
// seconds after a tick, so the office hears only once that has passed, and only if the job is still
// done from that same tick: an undone job says nothing, and of several ticks only the last one
// speaks. A note or a photo of the fix added in the meantime goes with it.
const DONE_GRACE_MS = 15_000;

async function tellTheOfficeDone(me: TodoMe, id: string, doneAt: string): Promise<void> {
  try {
    await new Promise((resolve) => setTimeout(resolve, DONE_GRACE_MS));
    const task = await getTask(id);
    if (!task || task.status !== "done" || task.doneAt !== doneAt) return;
    const open = `/todo/jobs?open=${task.id}`;
    const image = task.fixUrl ?? task.photoUrl;
    await notifyOwner({
      kind: "todo",
      title: `${firstName(me.name)} ticked ${task.urgent ? "an urgent job" : "a job"} done`,
      lines: [
        jobLine(task),
        ...(task.area ? [areaLabel(task.area)] : []),
        ...(task.doneNote ? [`Note: ${task.doneNote}`] : []),
        ...(task.fixUrl ? ["With a photo of the fix."] : []),
      ],
      links: [{ label: "Open the job", url: open }],
      urgent: true,
      tag: `todo-done-${task.id}`,
      open,
      image: image ? photoAt(image, 720) : undefined,
    });
  } catch (error) {
    console.error("[todo] done alert failed:", error instanceof Error ? error.message : error);
  }
}

type Action = "done" | "reopen" | "proof" | "edit";

export async function changeTask(me: TodoMe, id: string, body: Record<string, unknown>): Promise<TodoTask> {
  checkId(id);
  const action = body.action as Action;
  const client = getBuyersClient();
  const before = await client.fetch<{ status?: string; fix?: string; list: string; createdById?: string } | null>(
    `*[_id == $id && _type == "siteTask"][0]{ status, "fix": donePhoto.asset._ref, "list": coalesce(list, "site"), createdById }`,
    { id }
  );
  // A house job does not exist as far as a site login is concerned.
  if (!before || (before.list !== "site" && me.kind !== "admin")) throw new TodoError(404, "That item isn't on the list any more.");
  const now = new Date().toISOString();

  if (action === "done") {
    const note = cleanText(body.note, MAX_NOTE, "note");
    const fixId = cleanPhotoId(body.photoId);
    await client
      .patch(id)
      .set({ status: "done", doneAt: now, doneBy: me.name, ...(note ? { doneNote: note } : {}), ...(fixId ? { donePhoto: photoRef(fixId) } : {}) })
      .commit();
    // The foreman ticked it: the office hears once the moment for Undo has passed (from the
    // latest tick only, so a double tap still makes one alert).
    if (me.kind === "site") after(() => tellTheOfficeDone(me, id, now));
  } else if (action === "reopen") {
    await client.patch(id).set({ status: "open", reopenedAt: now, reopenedBy: me.name }).unset(["doneAt", "doneBy", "doneNote", "donePhoto"]).commit();
    if (before.fix) await dropPhoto(before.fix);
  } else if (action === "proof") {
    if (before.status !== "done") throw new TodoError(409, "Tick it done first, then add the photo or note.");
    const set: Record<string, unknown> = {};
    if ("note" in body) set.doneNote = cleanText(body.note, MAX_NOTE, "note");
    const fixId = cleanPhotoId(body.photoId);
    if (fixId) set.donePhoto = photoRef(fixId);
    if (Object.keys(set).length === 0) throw new TodoError(400, "Add a photo or a note.");
    await client.patch(id).set(set).commit();
    if (fixId && before.fix && before.fix !== fixId) await dropPhoto(before.fix);
  } else if (action === "edit") {
    if (me.kind !== "admin" && before.createdById !== me.id) throw new TodoError(403, "Only the office can change a job someone else added.");
    const set: Record<string, unknown> = {};
    if ("text" in body) set.text = cleanText(body.text, MAX_TEXT, "note");
    if ("area" in body) set.area = cleanArea(body.area);
    if ("urgent" in body) set.urgent = body.urgent === true;
    await client.patch(id).set(set).commit();
  } else {
    throw new TodoError(400, "Unknown change.");
  }

  const task = await getTask(id);
  if (!task) throw new TodoError(404, "That item isn't on the list any more.");
  return task;
}

/** Off the list for good: the office any job; a site login the jobs it added itself. */
export async function deleteTask(me: TodoMe, id: string): Promise<void> {
  checkId(id);
  const client = getBuyersClient();
  const refs = await client.fetch<{ photo?: string; fix?: string; list: string; createdById?: string } | null>(
    `*[_id == $id && _type == "siteTask"][0]{ "photo": photo.asset._ref, "fix": donePhoto.asset._ref, "list": coalesce(list, "site"), createdById }`,
    { id }
  );
  if (!refs) return;
  if (me.kind !== "admin") {
    if (refs.list !== "site") throw new TodoError(404, "That item isn't on the list any more.");
    if (refs.createdById !== me.id) throw new TodoError(403, "Only the office can delete a job someone else added.");
  }
  await client.delete(id);
  for (const assetId of [refs.photo, refs.fix]) if (assetId) await dropPhoto(assetId);
}

/* ---------- photos ---------- */

const MAX_BYTES = 4_400_000; // the phone shrinks photos first; Vercel refuses over 4.5 MB anyway
const TYPES = ["image/jpeg", "image/png", "image/webp"];

/** The photo an upload sent, and its ticket when the phone gave it one (it may save the record before the photo lands). */
export async function photoUpload(request: Request): Promise<{ file: File; ticket: string | null }> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new TodoError(400, "No photo was sent.");
  }
  const file = form.get("photo");
  if (!(file instanceof File)) throw new TodoError(400, "No photo was sent.");
  const ticket = form.get("ticket");
  return { file, ticket: typeof ticket === "string" && TICKET_RE.test(ticket) ? ticket : null };
}

/**
 * A phone photo into the private store, named "<kind>-<date>-<hex>" (to-do photos "todo-", the store's "store-", the
 * roll call's "rollcall-", waybills "concrete-"). With a ticket it also goes onto any record already saved with it.
 */
export async function storePhoto(file: File, kind: "todo" | "store" | "rollcall" | "concrete" | "bill" = "todo", ticket: string | null = null): Promise<{ id: string; url: string }> {
  // Sent again after an answer that never reached the phone: the same photo, not a second copy.
  const landed = ticket ? await landedPhoto(ticket) : null;
  if (ticket && landed) {
    await attachPending(ticket);
    return landed;
  }
  // A bill can be a PDF (sent as it is): it goes into QuickBooks with the bill, and onto the payment that pays it.
  const pdf = kind === "bill" && file.type === "application/pdf";
  if (!pdf && !TYPES.includes(file.type)) throw new TodoError(415, kind === "bill" ? "That file can't be attached. Use a photo or a PDF." : "That file is not a JPEG, PNG or WebP photo.");
  if (file.size === 0) throw new TodoError(400, "No photo was sent.");
  if (file.size > MAX_BYTES) throw new TodoError(413, pdf ? "That PDF is too big (over 4 MB). Take a photo of it instead." : "That photo is too big (over 4 MB).");
  const ext = pdf ? "pdf" : file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const client = getBuyersClient();
  const asset = await client.assets.upload(pdf ? "file" : "image", Buffer.from(await file.arrayBuffer()), {
    filename: `${kind}-${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString("hex")}.${ext}`,
    contentType: file.type,
  });
  if (ticket) {
    await client.createOrReplace({ _id: PHOTO_TICKET_PREFIX + ticket, _type: "photoTicket", assetId: asset._id, url: asset.url, kind, at: new Date().toISOString() });
    await attachPending(ticket);
    // Only the moments around a save need a ticket: old ones go.
    const cut = new Date(Date.now() - 3 * 86_400_000).toISOString();
    after(() => client.delete({ query: `*[_type == "photoTicket" && string::startsWith(_id, $prefix) && at < $cut][0...100]`, params: { prefix: PHOTO_TICKET_PREFIX, cut } }).catch(() => {}));
  }
  return { id: asset._id, url: asset.url };
}

async function landedPhoto(ticket: string): Promise<{ id: string; url: string } | null> {
  return getBuyersClient().fetch<{ id: string; url: string } | null>(`*[_id == $id && defined(assetId)][0]{ "id": assetId, url }`, { id: PHOTO_TICKET_PREFIX + ticket });
}

// Every kind of record a phone photo can belong to (the waybills wait for theirs: they're read from it).
const PHOTO_TYPES = ["siteTask", "storeItem", "storeMove", "storeTool", "toolOut", "storeCheck", "supplierBill", "toolRepair", "storeBuy"];

/** A photo that landed after its record was saved: it takes the place of the record's marker. Never throws. */
export async function attachPending(ticket: string): Promise<void> {
  try {
    const landed = await landedPhoto(ticket);
    if (!landed) return;
    const client = getBuyersClient();
    const docs = await client.fetch<{ _id: string; photo: boolean | null; done: boolean | null; photos: string[] | null; returns: string[] | null }[]>(
      `*[_type in $types && (photo.pending == $t || donePhoto.pending == $t || count(photos[pending == $t]) > 0 || count(returns[photo.pending == $t]) > 0)]{
        _id, "photo": photo.pending == $t, "done": donePhoto.pending == $t, "photos": photos[pending == $t]._key, "returns": returns[photo.pending == $t]._key
      }`,
      { types: PHOTO_TYPES, t: ticket }
    );
    const ref = photoRef(landed.id);
    for (const doc of docs) {
      const set: Record<string, unknown> = {};
      if (doc.photo) set.photo = ref;
      if (doc.done) set.donePhoto = ref;
      for (const key of doc.photos ?? []) set[`photos[_key=="${key}"]`] = { _key: key, ...ref };
      for (const key of doc.returns ?? []) set[`returns[_key=="${key}"].photo`] = ref;
      if (Object.keys(set).length) await client.patch(doc._id).set(set).commit();
    }
  } catch (error) {
    console.error("[photos] putting a late photo on its record failed:", error instanceof Error ? error.message : error);
  }
}

/** Deletes a to-do (or store, or roll call) photo nothing points at any more (a retake, a removed or deleted item). */
export async function dropPhoto(assetId: string, kind: "todo" | "store" | "rollcall" | "concrete" | "bill" = "todo"): Promise<void> {
  if (!(PHOTO_ID_RE.test(assetId) || (kind === "bill" && PDF_ID_RE.test(assetId)))) return;
  const client = getBuyersClient();
  try {
    const info = await client.fetch<{ name?: string; refs: number } | null>(
      `*[_id == $id][0]{ "name": originalFilename, "refs": count(*[references(^._id)]) }`,
      { id: assetId }
    );
    if (info && info.refs === 0 && info.name?.startsWith(`${kind}-`)) await client.delete(assetId);
  } catch (error) {
    console.error(`[${kind}] photo clean-up failed:`, error instanceof Error ? error.message : error);
  }
}

/** A photo id sent by the phone, checked: null when there is none. "pending:<ticket>" is one still uploading. */
export function cleanPhotoRef(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !(PHOTO_ID_RE.test(value) || PENDING_RE.test(value))) throw new TodoError(400, "That photo didn't upload properly. Take it again.");
  return value;
}

/** As cleanPhotoRef, for a supplier's bill: its PDF will do too. */
export function cleanBillPhotoRef(value: unknown): string | null {
  return typeof value === "string" && PDF_ID_RE.test(value) ? value : cleanPhotoRef(value);
}

/* ---------- site logins (the foreman, a storekeeper) ---------- */

export async function listSiteAccounts(): Promise<SiteAccount[]> {
  const list = await getBuyersClient().fetch<(Omit<SiteAccount, "sections"> & { siteAccess?: unknown })[]>(
    `*[_type == "buyerAccount" && role == "site"] | order(lower(name) asc){ "id": _id, "name": coalesce(name, ""), email, siteAccess }`
  );
  return list.map(({ siteAccess, ...a }) => ({ ...a, sections: siteSections(siteAccess) }));
}

function cleanSections(value: unknown): SiteSection[] {
  const sections = siteSections(Array.isArray(value) ? value : []);
  if (sections.length === 0) throw new TodoError(400, "Tick at least one part for this login.");
  return sections;
}

// Easy to read out or type on a phone: 3 groups of 4 from letters and digits that can't be
// mistaken for each other (no 0/o, 1/l/i).
function friendlyPassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const pick = () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join("");
  return `${pick()}-${pick()}-${pick()}`;
}

// Someone with no email (the storekeeper) signs in with a username instead: kept in the email field, so the sign-in
// works as it is. Niko, 2 Nov 2026: "my storekeeper doesn't have an email, let's make a 'storekeeper' user name".
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;

export async function createSiteAccount(body: Record<string, unknown>): Promise<{ account: SiteAccount; password: string }> {
  const name = cleanText(body.name, 80, "name");
  const email = cleanText(body.email, 120, "email").toLowerCase();
  if (!name) throw new TodoError(400, "Type the person's name.");
  if (email.includes("@") ? !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) : !USERNAME_RE.test(email)) {
    throw new TodoError(400, email.includes("@") ? "That email address doesn't look right." : "A username is 3 to 30 letters or numbers in one word (a dot, dash or underscore is fine), e.g. storekeeper.");
  }
  const sections = cleanSections(body.sections ?? ["todo", "store"]);
  const client = getBuyersClient();
  const existing = await client.fetch<{ role?: string } | null>(`*[_type == "buyerAccount" && lower(email) == $email][0]{ role }`, { email });
  if (existing) throw new TodoError(409, `There's already a login with that ${email.includes("@") ? "email" : "username"}. Use a different one for this person.`);
  const password = friendlyPassword();
  const doc = await client.create({
    _type: "buyerAccount",
    email,
    name,
    role: "site",
    siteAccess: sections,
    passwordHash: await hashPassword(password),
    payments: [],
    signedAgreements: [],
  });
  accounts.delete(email);
  return { account: { id: doc._id, name, email, sections }, password };
}

/** Which parts of the app a site login opens (takes effect within a minute). */
export async function setSiteAccess(id: string, value: unknown): Promise<SiteSection[]> {
  const account = await siteAccount(id);
  const sections = cleanSections(value);
  await getBuyersClient().patch(id).set({ siteAccess: sections }).commit();
  accounts.delete(account.email.toLowerCase());
  return sections;
}

async function siteAccount(id: string): Promise<{ email: string }> {
  if (typeof id !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(id)) throw new TodoError(404, "That login no longer exists.");
  const account = await getBuyersClient().fetch<{ role?: string; email: string } | null>(`*[_id == $id && _type == "buyerAccount"][0]{ role, email }`, { id });
  // Only "site" logins can be changed from here -- never a buyer's or an admin's.
  if (!account || account.role !== "site") throw new TodoError(404, "That login no longer exists.");
  return account;
}

export async function resetSiteAccount(id: string): Promise<string> {
  const account = await siteAccount(id);
  const password = friendlyPassword();
  await getBuyersClient().patch(id).set({ passwordHash: await hashPassword(password) }).commit();
  accounts.delete(account.email.toLowerCase());
  return password;
}

export async function removeSiteAccount(id: string): Promise<void> {
  const account = await siteAccount(id);
  await getBuyersClient().delete(id);
  accounts.delete(account.email.toLowerCase());
}

/* ---------- route helpers ---------- */

export function errorResponse(error: unknown): Response {
  if (error instanceof TodoError) return Response.json({ error: error.message }, { status: error.status });
  console.error("[todo]", error instanceof Error ? error.message : error);
  return Response.json({ error: "Something went wrong on our side. Check your signal and try again." }, { status: 502 });
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
