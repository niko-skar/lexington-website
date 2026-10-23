import "server-only";
import { randomBytes, randomInt } from "node:crypto";

import { hashPassword } from "@/lib/auth/password";
import { getAdminSession, getBuyerSession } from "@/lib/auth/session";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import {
  AREAS,
  MAX_NOTE,
  MAX_TEXT,
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

/** What a site login opens. Logins made before the store existed (the foreman's) have both: Niko,
 *  22 Oct 2026: "albert and I can record materials going out". */
function siteSections(value: unknown): SiteSection[] {
  if (!Array.isArray(value)) return [...SITE_SECTIONS];
  return SITE_SECTIONS.filter((s) => value.includes(s));
}

/** Admins (Niko's account, or the office password) and "site" accounts (the foreman, a storekeeper). */
export async function getTodoUser(): Promise<TodoMe | null> {
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

export const photoRef = (assetId: string) => ({ _type: "image", asset: { _type: "reference", _ref: assetId } });

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
    list: body.list === "house" ? "house" : "site",
    text,
    area: cleanArea(body.area),
    urgent: body.urgent === true,
    status: "open",
    createdAt: new Date().toISOString(),
    createdBy: me.name,
    ...(photoId ? { photo: photoRef(photoId) } : {}),
  });
  const task = await getTask(id);
  if (!task) throw new TodoError(502, "It was saved but couldn't be read back. Pull down to refresh.");
  return task;
}

type Action = "done" | "reopen" | "proof" | "edit";

export async function changeTask(me: TodoMe, id: string, body: Record<string, unknown>): Promise<TodoTask> {
  checkId(id);
  const action = body.action as Action;
  const client = getBuyersClient();
  const before = await client.fetch<{ status?: string; fix?: string; list: string } | null>(
    `*[_id == $id && _type == "siteTask"][0]{ status, "fix": donePhoto.asset._ref, "list": coalesce(list, "site") }`,
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
    if (me.kind !== "admin") throw new TodoError(403, "Only the office can change an item.");
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

export async function deleteTask(id: string): Promise<void> {
  checkId(id);
  const client = getBuyersClient();
  const refs = await client.fetch<{ photo?: string; fix?: string } | null>(
    `*[_id == $id && _type == "siteTask"][0]{ "photo": photo.asset._ref, "fix": donePhoto.asset._ref }`,
    { id }
  );
  if (!refs) return;
  await client.delete(id);
  for (const assetId of [refs.photo, refs.fix]) if (assetId) await dropPhoto(assetId);
}

/* ---------- photos ---------- */

const MAX_BYTES = 4_400_000; // the phone shrinks photos first; Vercel refuses over 4.5 MB anyway
const TYPES = ["image/jpeg", "image/png", "image/webp"];

/** A phone photo into the private store, named "<kind>-<date>-<hex>" (to-do photos "todo-", the store's "store-"). */
export async function storePhoto(file: File, kind: "todo" | "store" = "todo"): Promise<{ id: string; url: string }> {
  if (!TYPES.includes(file.type)) throw new TodoError(415, "That file is not a JPEG, PNG or WebP photo.");
  if (file.size === 0) throw new TodoError(400, "No photo was sent.");
  if (file.size > MAX_BYTES) throw new TodoError(413, "That photo is too big (over 4 MB).");
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const asset = await getBuyersClient().assets.upload("image", Buffer.from(await file.arrayBuffer()), {
    filename: `${kind}-${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString("hex")}.${ext}`,
    contentType: file.type,
  });
  return { id: asset._id, url: asset.url };
}

/** Deletes a to-do (or store) photo nothing points at any more (a retake, a removed or deleted item). */
export async function dropPhoto(assetId: string, kind: "todo" | "store" = "todo"): Promise<void> {
  if (!PHOTO_ID_RE.test(assetId)) return;
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

/** A photo id sent by the phone, checked: null when there is none. */
export function cleanPhotoRef(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !PHOTO_ID_RE.test(value)) throw new TodoError(400, "That photo didn't upload properly. Take it again.");
  return value;
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
  if (sections.length === 0) throw new TodoError(400, "Tick at least one: the to-do list or the store room.");
  return sections;
}

// Easy to read out or type on a phone: 3 groups of 4 from letters and digits that can't be
// mistaken for each other (no 0/o, 1/l/i).
function friendlyPassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const pick = () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join("");
  return `${pick()}-${pick()}-${pick()}`;
}

export async function createSiteAccount(body: Record<string, unknown>): Promise<{ account: SiteAccount; password: string }> {
  const name = cleanText(body.name, 80, "name");
  const email = cleanText(body.email, 120, "email").toLowerCase();
  if (!name) throw new TodoError(400, "Type the person's name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new TodoError(400, "That email address doesn't look right.");
  const sections = cleanSections(body.sections ?? SITE_SECTIONS);
  const client = getBuyersClient();
  const existing = await client.fetch<{ role?: string } | null>(`*[_type == "buyerAccount" && lower(email) == $email][0]{ role }`, { email });
  if (existing) throw new TodoError(409, "There's already a login with that email. Use a different email for this person.");
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
