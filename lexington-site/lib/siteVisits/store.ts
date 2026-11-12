import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Resend } from "resend";

import { notifyOwner } from "@/lib/alerts/notify";
import { firstName } from "@/lib/crm";
import { samePerson } from "@/lib/crmMatch";
import { visitEmail, type VisitEmailKind } from "@/lib/email/templates";
import { whatsappUrl } from "@/lib/format";
import { googleMapsUrl } from "@/lib/maps";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { client as publicClient } from "@/lib/sanity/client";
import { siteSettingsQuery } from "@/lib/sanity/queries";
import type { SiteSettings } from "@/lib/sanity/types";
import { SITE_URL } from "@/lib/seo";

import { visitIcs } from "./ics";
import {
  BOOK_AHEAD_DAYS,
  MIN_NOTICE_MS,
  BOOKED_VIA,
  VISIT_PLACE,
  bookable,
  byDay,
  dayLabel,
  freeSlots,
  openSlots,
  rangeLabel,
  slotDay,
  slotKey,
  slotLabel,
  slotStartMs,
  type SlotKey,
  type VisitRow,
  type VisitSource,
  type VisitStatus,
  type VisitsData,
} from "./shared";

/**
 * Site visits (lib/siteVisits/shared.ts has the hours and why). Each booking is a private document in the buyers
 * dataset ("sitevisit-live-<hex>"), and its hour is held by a second one named after the hour itself
 * ("visitslot-live-2026-11-13T10"): the two are made in one go, and Sanity refuses a second document of the same name,
 * so two people can never take the same hour, whatever arrives at once. Cancelling or moving a visit lets its hour go.
 * Niko blocks an hour (away, busy) with the same kind of document, marked blocked. A preview build or a laptop writes
 * "-dev-" names, so a test never takes a real hour or shows on Niko's phone.
 */

const LIVE = process.env.VERCEL_ENV === "production";
export const VISIT_PREFIX = LIVE ? "sitevisit-live-" : "sitevisit-dev-";
const SLOT_PREFIX = LIVE ? "visitslot-live-" : "visitslot-dev-";
const FROM = "The Lexington <sales@lexington.com.gh>";
const DAY = 86_400_000;

const newKey = () => randomBytes(6).toString("hex");
const buyers = () => getBuyersClient();

interface VisitDoc {
  _id: string;
  _rev: string;
  slot: string;
  name: string;
  phone?: string;
  email?: string;
  people?: number;
  interest?: string;
  note?: string;
  source: VisitSource;
  leadId?: string;
  threadId?: string;
  /** The open step on their record ("Show Ama the site..."), ticked off when the visit is done or cancelled. */
  taskKey?: string;
  status: VisitStatus;
  createdAt: string;
  remindedAt?: string;
  remindedBy?: string;
  outcomeAt?: string;
  rebookSentAt?: string;
  moves?: number;
  rebookOf?: string;
}

interface SlotDoc {
  _id: string;
  slot: string;
  visitId?: string;
  blocked?: boolean;
}

const VISIT_FIELDS = `_id, _rev, slot, name, phone, email, people, interest, note, source, leadId, threadId, taskKey, status, createdAt, remindedAt, remindedBy, outcomeAt, rebookSentAt, moves, rebookOf`;

export function rowOf(d: VisitDoc): VisitRow {
  return {
    id: d._id,
    slot: d.slot,
    name: d.name,
    phone: d.phone ?? "",
    email: d.email ?? "",
    people: d.people ?? null,
    interest: d.interest ?? "",
    note: d.note ?? "",
    source: d.source,
    leadId: d.leadId ?? null,
    status: d.status,
    createdAt: d.createdAt,
    remindedAt: d.remindedAt ?? null,
    remindedBy: d.remindedBy ?? null,
    outcomeAt: d.outcomeAt ?? null,
    rebookSentAt: d.rebookSentAt ?? null,
    moves: d.moves ?? 0,
  };
}

export const isVisitId = (id: string) => id.startsWith(VISIT_PREFIX) && /^[a-z]+-(live|dev)-[0-9a-f]{12}$/.test(id);

async function readVisit(id: string): Promise<VisitDoc | null> {
  if (!isVisitId(id)) return null;
  return buyers().fetch<VisitDoc | null>(`*[_id == $id][0]{ ${VISIT_FIELDS} }`, { id });
}

// ---- the visitor's own link (change or cancel), and where links point ------------------------------------------

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set.");
  return s;
}

export function visitToken(id: string): string {
  return createHmac("sha256", secret()).update(`site-visit:${id}`).digest("base64url").slice(0, 24);
}

export function tokenOk(id: string, token: string): boolean {
  if (!isVisitId(id) || typeof token !== "string" || token.length !== 24) return false;
  const a = Buffer.from(visitToken(id));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The live site's address; a preview build's own; a laptop's VISIT_BASE_URL. Links in emails go there. */
export function linkBase(): string {
  if (LIVE) return SITE_URL;
  if (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return process.env.VISIT_BASE_URL?.replace(/\/+$/, "") || SITE_URL;
}

export const manageUrl = (id: string) => `${linkBase()}/visit/manage?v=${encodeURIComponent(id)}&t=${visitToken(id)}`;
export const icsUrl = (id: string) => `${linkBase()}/api/site-visit/ics?v=${encodeURIComponent(id)}&t=${visitToken(id)}`;

// ---- which hours are taken ------------------------------------------------------------------------------------------

let cache: { at: number; taken: Set<string> } | null = null;
const CACHE_MS = 20_000;

/** The hours from now on that are booked or blocked (one small query, kept for 20 seconds per server). */
export async function takenSlots(nowMs = Date.now(), fresh = false): Promise<Set<string>> {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.taken;
  const keys = await buyers().fetch<string[]>(`*[_type == "visitSlot" && string::startsWith(_id, $prefix) && slot >= $from].slot`, {
    prefix: SLOT_PREFIX,
    from: slotKey(nowMs - DAY),
  });
  cache = { at: Date.now(), taken: new Set(keys) };
  return cache.taken;
}

const forgetTaken = () => {
  cache = null;
};

/** What visitors can book now. */
export async function freeVisitSlots(nowMs = Date.now(), days?: number): Promise<SlotKey[]> {
  return freeSlots(nowMs, await takenSlots(nowMs), days);
}

/** Other free hours on the same day as `slot` (or the next days with any), for "that time has just gone". */
async function alternatives(slot: string, nowMs: number): Promise<SlotKey[]> {
  const free = freeSlots(nowMs, await takenSlots(nowMs, true));
  const sameDay = free.filter((k) => slotDay(k) === slotDay(slot));
  return (sameDay.length ? sameDay : byDay(free.filter((k) => k > slot)).slice(0, 2).flatMap((d) => d.slots)).slice(0, 8);
}

const isConflict = (error: unknown) => {
  const e = error as { statusCode?: number; message?: string };
  return e?.statusCode === 409 || /already exists|conflict/i.test(e?.message ?? "");
};

// ---- emails ---------------------------------------------------------------------------------------------------

let settingsCache: { at: number; value: SiteSettings } | null = null;
async function siteSettings(): Promise<SiteSettings> {
  if (settingsCache && Date.now() - settingsCache.at < 300_000) return settingsCache.value;
  const value = await publicClient.fetch<SiteSettings>(siteSettingsQuery);
  settingsCache = { at: Date.now(), value };
  return value;
}

/** Sends one of the visit emails (with the calendar file while the visit is on). True when Resend took it. */
async function sendVisitEmail(kind: VisitEmailKind, v: VisitDoc): Promise<boolean> {
  if (!v.email) return false;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[visits] RESEND_API_KEY is not set: no visit emails can go out.");
    return false;
  }
  try {
    const settings = await siteSettings();
    const when = `${dayLabel(slotDay(v.slot))}, ${rangeLabel(v.slot)}`;
    const mail = visitEmail({
      kind,
      name: v.name,
      when,
      whenShort: slotLabel(v.slot),
      people: v.people ?? null,
      mapUrl: googleMapsUrl(),
      manageUrl: manageUrl(v._id),
      bookUrl: manageUrl(v._id),
      siteSettings: settings,
    });
    const on = kind === "booked" || kind === "moved" || kind === "reminder";
    const ics = on
      ? visitIcs({
          id: v._id,
          slot: v.slot,
          location: settings.officeAddress,
          description: `Your visit to The Lexington. Map: ${googleMapsUrl()}. To change or cancel: ${manageUrl(v._id)}`,
          url: manageUrl(v._id),
        })
      : null;
    const result = await new Resend(apiKey).emails.send({
      from: FROM,
      to: v.email,
      replyTo: settings.contactEmail,
      subject: mail.subject,
      html: mail.html,
      ...(ics ? { attachments: [{ filename: "Site-visit-The-Lexington.ics", content: Buffer.from(ics).toString("base64") }] } : {}),
    });
    if (result.error) {
      console.error("[visits] Resend refused the email:", result.error);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[visits] the email could not be sent:", error instanceof Error ? error.message : error);
    return false;
  }
}

// ---- their record in Prospects ------------------------------------------------------------------------------

const leadNote = (text: string) => ({ _key: newKey(), at: new Date().toISOString(), kind: "system", text: text.slice(0, 3000) });

/** A line on their record (and, when given, a new step), never throwing. */
async function onLead(leadId: string | undefined, text: string, task?: { text: string; due: string; waitingOn?: "me" | "them" }, doneKey?: string): Promise<void> {
  if (!leadId) return;
  try {
    let tx = buyers()
      .transaction()
      .patch(leadId, (p) => p.setIfMissing({ notes: [], tasks: [] }))
      .patch(leadId, (p) => p.append("notes", [leadNote(text)]));
    if (task) {
      tx = tx.patch(leadId, (p) =>
        p.append("tasks", [{ _key: newKey(), text: task.text.slice(0, 200), due: task.due, waitingOn: task.waitingOn ?? "me", done: false, createdAt: new Date().toISOString() }])
      );
    }
    if (doneKey) tx = tx.patch(leadId, (p) => p.set({ [`tasks[_key=="${doneKey}"].done`]: true }));
    await tx.commit();
  } catch (error) {
    console.error("[visits] their record wasn't updated:", error instanceof Error ? error.message : error);
  }
}

/** The visit's step on their record: its new time, or ticked off. */
async function setVisitTask(leadId: string | undefined, taskKey: string | undefined, set: Record<string, unknown>): Promise<void> {
  if (!leadId || !taskKey) return;
  const fields = Object.fromEntries(Object.entries(set).map(([k, v]) => [`tasks[_key=="${taskKey}"].${k}`, v]));
  await buyers()
    .patch(leadId)
    .set(fields)
    .commit()
    .catch((e: Error) => console.error("[visits] their step wasn't updated:", e.message));
}

const visitTaskText = (name: string, slot: string) => `Site visit: show ${firstName(name)} the site, ${slotLabel(slot)}`;

/**
 * Finds (or makes) their record in Prospects and puts the visit on it: a line in the timeline, the visit as a step on
 * its day, and a new enquiry moves on to "Contacted". Answers the record's id and the step's key.
 */
async function putOnRecord(v: { name: string; email: string; phone: string; slot: string; source: VisitSource; interest: string; people: number | null; note: string; leadId?: string | null; leadSource?: string }): Promise<{ leadId: string | null; taskKey: string }> {
  const taskKey = newKey();
  // A preview build (the test version Niko tries before it goes live) never writes to Prospects.
  if (process.env.VERCEL_ENV === "preview") return { leadId: null, taskKey };
  const now = new Date().toISOString();
  const what = [
    `Booked a site visit ${BOOKED_VIA[v.source]}: ${slotLabel(v.slot)}.`,
    v.people ? `${v.people} ${v.people === 1 ? "person" : "people"}.` : "",
    v.interest ? `Would like to see: ${v.interest}.` : "",
    v.note ? `Their note: ${v.note}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const task = { _key: taskKey, text: visitTaskText(v.name, v.slot), due: slotDay(v.slot), waitingOn: "me", done: false, createdAt: now };
  try {
    const client = buyers();
    const leadId = v.leadId || (await samePerson(v.email, v.phone));
    if (leadId) {
      const lead = await client.fetch<{ _id: string; stage?: string; phone?: string; email?: string; interest?: string } | null>(`*[_id == $id][0]{ _id, stage, phone, email, interest }`, { id: leadId });
      if (lead) {
        const set: Record<string, unknown> = {};
        if (!lead.phone && v.phone) set.phone = v.phone;
        if (!lead.email && v.email) set.email = v.email;
        if (!lead.interest && v.interest && v.interest !== "Not sure yet") set.interest = v.interest;
        // Someone new, or written off, who books a visit is a live prospect in touch with us.
        if (!lead.stage || lead.stage === "new" || lead.stage === "lost") set.stage = "contacted";
        await client
          .transaction()
          .patch(leadId, (p) => p.setIfMissing({ notes: [], tasks: [] }))
          .patch(leadId, (p) => p.append("notes", [{ _key: newKey(), at: now, kind: "system", text: what }]))
          .patch(leadId, (p) => {
            let next = p.append("tasks", [task]);
            if (Object.keys(set).length) next = next.set(set);
            return lead.stage === "lost" ? next.unset(["lostReason"]) : next;
          })
          .commit();
        return { leadId, taskKey };
      }
    }
    const doc = await client.create({
      _type: "lead",
      name: v.name.slice(0, 120),
      ...(v.email && { email: v.email }),
      ...(v.phone && { phone: v.phone }),
      source: v.leadSource ?? "website",
      stage: "contacted",
      ...(v.interest && v.interest !== "Not sure yet" && { interest: v.interest }),
      paymentPreference: "undecided",
      tasks: [task],
      notes: [{ _key: newKey(), at: now, kind: "system", text: what }],
    });
    return { leadId: doc._id, taskKey };
  } catch (error) {
    console.error("[visits] the visit isn't on their record:", error instanceof Error ? error.message : error);
    return { leadId: v.leadId ?? null, taskKey };
  }
}

/** The WhatsApp message Niko can send in one tap when there is no email to confirm or remind by. */
export function whatsappNote(v: { name: string; phone: string; slot: string }, kind: "booked" | "reminder" | "missed"): string {
  if (!v.phone) return "";
  const first = firstName(v.name);
  const text =
    kind === "booked"
      ? `Hi ${first}, this is The Lexington. Your site visit is booked for ${slotLabel(v.slot)}. We are at ${VISIT_PLACE}: ${googleMapsUrl()}. See you then!`
      : kind === "reminder"
        ? `Hi ${first}, this is The Lexington: a reminder of your site visit tomorrow at ${slotLabel(v.slot).replace(/^.* at /, "")}. We are at ${VISIT_PLACE}: ${googleMapsUrl()}. See you then!`
        : `Hi ${first}, this is The Lexington. We missed you at your site visit on ${slotLabel(v.slot)}. Would you like to pick another time?`;
  return whatsappUrl(v.phone, text);
}

// ---- booking -------------------------------------------------------------------------------------------------

export interface NewVisit {
  slot: string;
  name: string;
  phone: string;
  email: string;
  people: number | null;
  interest: string;
  note: string;
  source: VisitSource;
  /** For a brand-new prospect: the CRM's source key (meta_ads, google_ads, website...). */
  leadSource?: string;
  /** Already known (a chat's prospect). */
  leadId?: string | null;
  threadId?: string;
  rebookOf?: string;
}

export type BookResult =
  | { ok: true; visit: VisitRow; manageUrl: string; icsUrl: string; leadId: string | null; emailed: boolean }
  | { ok: false; reason: "closed" | "taken" | "error"; alternatives: SlotKey[] };

/** Books one hour for someone: the hour, their record, Niko's alert, their confirmation email. Never throws. */
export async function bookVisit(input: NewVisit, nowMs = Date.now()): Promise<BookResult> {
  const notice = input.source === "office" ? 0 : MIN_NOTICE_MS;
  if (!bookable(input.slot, nowMs, notice)) return { ok: false, reason: "closed", alternatives: await alternatives(input.slot, nowMs).catch(() => []) };
  const id = VISIT_PREFIX + newKey();
  const now = new Date(nowMs).toISOString();
  const doc = {
    _id: id,
    _type: "siteVisit",
    slot: input.slot,
    name: input.name.trim().slice(0, 120),
    ...(input.phone && { phone: input.phone.trim().slice(0, 40) }),
    ...(input.email && { email: input.email.trim().toLowerCase().slice(0, 160) }),
    ...(input.people && { people: Math.max(1, Math.min(20, Math.round(input.people))) }),
    ...(input.interest && { interest: input.interest.slice(0, 80) }),
    ...(input.note && { note: input.note.slice(0, 1000) }),
    source: input.source,
    ...(input.threadId && { threadId: input.threadId }),
    ...(input.rebookOf && { rebookOf: input.rebookOf }),
    status: "booked" as VisitStatus,
    createdAt: now,
    moves: 0,
  };
  try {
    await buyers()
      .transaction()
      .create({ _id: SLOT_PREFIX + input.slot, _type: "visitSlot", slot: input.slot, visitId: id, createdAt: now })
      .create(doc)
      .commit();
  } catch (error) {
    forgetTaken();
    if (isConflict(error)) return { ok: false, reason: "taken", alternatives: await alternatives(input.slot, nowMs).catch(() => []) };
    console.error("[visits] the visit could not be booked:", error instanceof Error ? error.message : error);
    return { ok: false, reason: "error", alternatives: [] };
  }
  forgetTaken();

  const { leadId, taskKey } = await putOnRecord({
    name: doc.name,
    email: doc.email ?? "",
    phone: doc.phone ?? "",
    slot: doc.slot,
    source: doc.source,
    interest: doc.interest ?? "",
    people: doc.people ?? null,
    note: doc.note ?? "",
    leadId: input.leadId,
    leadSource: input.leadSource,
  });
  await buyers()
    .patch(id)
    .set({ ...(leadId && { leadId }), taskKey })
    .commit()
    .catch(() => undefined);
  const visit: VisitDoc = { ...doc, _rev: "", leadId: leadId ?? undefined, taskKey };
  const emailed = await sendVisitEmail("booked", visit);

  const wa = whatsappNote({ name: visit.name, phone: visit.phone ?? "", slot: visit.slot }, "booked");
  // One the office booked itself needs no alert.
  if (visit.source !== "office") await notifyOwner({
    kind: "visit",
    urgent: true,
    title: `Site visit booked: ${visit.name}, ${slotLabel(visit.slot, true)}`,
    lines: [
      `${dayLabel(slotDay(visit.slot))}, ${rangeLabel(visit.slot)}. Booked ${BOOKED_VIA[visit.source]}.`,
      visit.phone ? `Phone: ${visit.phone}` : "",
      visit.email ? `Email: ${visit.email}` : "",
      visit.people ? `People: ${visit.people}` : "",
      visit.interest ? `Would like to see: ${visit.interest}` : "",
      visit.note ? `Their note: ${visit.note}` : "",
      emailed
        ? `A confirmation went to ${visit.email}, and a reminder goes the day before.`
        : visit.threadId
          ? "They were told in the chat; a reminder goes there the day before."
          : "No email: send them the WhatsApp confirmation below.",
    ],
    links: [
      { label: "Site visits", url: "/todo/visits" },
      ...(leadId ? [{ label: "Their record", url: `/admin/crm/${leadId}` }] : []),
      ...(wa && !emailed && !visit.threadId ? [{ label: "WhatsApp the confirmation", url: wa }] : []),
    ],
    open: "/todo/visits",
  });

  return { ok: true, visit: rowOf({ ...visit, _rev: "" }), manageUrl: manageUrl(id), icsUrl: icsUrl(id), leadId, emailed };
}

// ---- changing one ------------------------------------------------------------------------------------------

/** The visitor's page: their visit as it stands, for its owner only (the link's token). */
export async function visitForOwner(id: string, token: string): Promise<VisitRow | null> {
  if (!tokenOk(id, token)) return null;
  const v = await readVisit(id);
  return v ? rowOf(v) : null;
}

/** Lets an hour go, if it still belongs to this visit. */
async function releaseSlot(slot: string, visitId: string): Promise<void> {
  const lock = await buyers().getDocument<SlotDoc>(SLOT_PREFIX + slot);
  if (lock?.visitId === visitId) await buyers().delete(lock._id);
  forgetTaken();
}

export type ChangeResult = { ok: true; visit: VisitRow } | { ok: false; reason: "closed" | "taken" | "gone" | "error"; alternatives: SlotKey[] };

/**
 * A new time for a visit. A booked one moves (its old hour is let go in the same step); a missed or cancelled one is
 * booked again as a new visit with the same details. `by` says who did it (the visitor on their page, or the office).
 */
export async function changeVisit(id: string, slot: string, by: "visitor" | "office", nowMs = Date.now()): Promise<ChangeResult> {
  const v = await readVisit(id);
  if (!v) return { ok: false, reason: "gone", alternatives: [] };
  if (!bookable(slot, nowMs, by === "office" ? 0 : MIN_NOTICE_MS)) return { ok: false, reason: "closed", alternatives: await alternatives(slot, nowMs).catch(() => []) };
  if (v.status !== "booked") {
    const again = await bookVisit(
      { slot, name: v.name, phone: v.phone ?? "", email: v.email ?? "", people: v.people ?? null, interest: v.interest ?? "", note: v.note ?? "", source: by === "office" ? "office" : "website", leadId: v.leadId, rebookOf: v._id },
      nowMs
    );
    return again.ok ? { ok: true, visit: again.visit } : { ok: false, reason: again.reason, alternatives: again.alternatives };
  }
  if (slot === v.slot) return { ok: true, visit: rowOf(v) };
  const now = new Date(nowMs).toISOString();
  try {
    const lock = await buyers().getDocument<SlotDoc>(SLOT_PREFIX + v.slot);
    let tx = buyers()
      .transaction()
      .create({ _id: SLOT_PREFIX + slot, _type: "visitSlot", slot, visitId: v._id, createdAt: now })
      .patch(v._id, (p) => p.ifRevisionId(v._rev).set({ slot, moves: (v.moves ?? 0) + 1 }).unset(["remindedAt", "remindedBy"]));
    if (lock?.visitId === v._id) tx = tx.delete(lock._id);
    await tx.commit();
  } catch (error) {
    forgetTaken();
    if (isConflict(error)) return { ok: false, reason: "taken", alternatives: await alternatives(slot, nowMs).catch(() => []) };
    console.error("[visits] the visit could not be moved:", error instanceof Error ? error.message : error);
    return { ok: false, reason: "error", alternatives: [] };
  }
  forgetTaken();
  const moved: VisitDoc = { ...v, slot, moves: (v.moves ?? 0) + 1, remindedAt: undefined, remindedBy: undefined };
  await setVisitTask(v.leadId, v.taskKey, { text: visitTaskText(v.name, slot), due: slotDay(slot) });
  await onLead(v.leadId, `Site visit moved ${by === "visitor" ? "by them" : "by you"}: from ${slotLabel(v.slot)} to ${slotLabel(slot)}.`);
  const emailed = await sendVisitEmail("moved", moved);
  if (by === "visitor") {
    await notifyOwner({
      kind: "visit",
      urgent: true,
      title: `Site visit moved: ${v.name}, now ${slotLabel(slot, true)}`,
      lines: [`It was ${slotLabel(v.slot)}. They changed it themselves.`, v.phone ? `Phone: ${v.phone}` : "", emailed ? `The new time went to ${v.email}.` : ""],
      links: [{ label: "Site visits", url: "/todo/visits" }, ...(v.leadId ? [{ label: "Their record", url: `/admin/crm/${v.leadId}` }] : [])],
      open: "/todo/visits",
    });
  }
  return { ok: true, visit: rowOf({ ...moved, _rev: "" }) };
}

/** Cancels a booked visit and lets its hour go. The visitor gets an email saying so either way. */
export async function cancelVisit(id: string, by: "visitor" | "office", nowMs = Date.now()): Promise<{ ok: boolean; visit?: VisitRow; whatsapp?: string }> {
  const v = await readVisit(id);
  if (!v) return { ok: false };
  if (v.status !== "booked") return { ok: true, visit: rowOf(v) };
  const now = new Date(nowMs).toISOString();
  try {
    await buyers().patch(v._id).ifRevisionId(v._rev).set({ status: "cancelled", outcomeAt: now, cancelledBy: by }).commit();
  } catch (error) {
    console.error("[visits] the visit could not be cancelled:", error instanceof Error ? error.message : error);
    return { ok: false };
  }
  await releaseSlot(v.slot, v._id).catch(() => undefined);
  await setVisitTask(v.leadId, v.taskKey, { done: true });
  await onLead(v.leadId, `Site visit on ${slotLabel(v.slot)} cancelled ${by === "visitor" ? "by them" : "by you"}.`);
  const emailed = await sendVisitEmail(by === "visitor" ? "cancelled" : "cancelledByUs", v);
  const done: VisitDoc = { ...v, status: "cancelled", outcomeAt: now };
  if (by === "visitor") {
    await notifyOwner({
      kind: "visit",
      urgent: true,
      title: `Site visit cancelled: ${v.name}, ${slotLabel(v.slot, true)}`,
      lines: ["They cancelled it themselves; the hour is free again.", v.phone ? `Phone: ${v.phone}` : ""],
      links: [{ label: "Site visits", url: "/todo/visits" }, ...(v.leadId ? [{ label: "Their record", url: `/admin/crm/${v.leadId}` }] : [])],
      open: "/todo/visits",
    });
  }
  const whatsapp = !emailed && v.phone ? whatsappUrl(v.phone, `Hi ${firstName(v.name)}, this is The Lexington. We are sorry, we can't show you the site on ${slotLabel(v.slot)} after all. Could we find another time? You can pick one here: ${manageUrl(v._id)}`) : undefined;
  return { ok: true, visit: rowOf(done), whatsapp };
}

/**
 * After the visit: they came (a follow-up step for the next day), or they didn't (a "pick another time" email, and
 * a step to call them). Answers a WhatsApp link to send by hand when there is no email.
 */
export async function markVisit(id: string, outcome: "came" | "missed", nowMs = Date.now()): Promise<{ ok: boolean; visit?: VisitRow; whatsapp?: string }> {
  const v = await readVisit(id);
  if (!v) return { ok: false };
  const start = slotStartMs(v.slot) ?? 0;
  if (v.status === "cancelled" || start > nowMs) return { ok: false };
  if (v.status === outcome) return { ok: true, visit: rowOf(v) };
  const now = new Date(nowMs).toISOString();
  try {
    await buyers().patch(v._id).ifRevisionId(v._rev).set({ status: outcome, outcomeAt: now }).commit();
  } catch (error) {
    console.error("[visits] the visit could not be marked:", error instanceof Error ? error.message : error);
    return { ok: false };
  }
  await setVisitTask(v.leadId, v.taskKey, { done: true });
  const tomorrow = slotKey(nowMs + DAY).slice(0, 10);
  const today = slotKey(nowMs).slice(0, 10);
  let whatsapp: string | undefined;
  let rebookSentAt: string | undefined;
  if (outcome === "came") {
    await onLead(v.leadId, `Came to see the site on ${slotLabel(v.slot)}.`, { text: `Follow up with ${firstName(v.name)} after their site visit`, due: tomorrow });
  } else {
    const emailed = v.rebookSentAt ? true : await sendVisitEmail("missed", v);
    if (emailed && !v.rebookSentAt) {
      rebookSentAt = now;
      await buyers().patch(v._id).set({ rebookSentAt }).commit().catch(() => undefined);
    }
    whatsapp = whatsappNote({ name: v.name, phone: v.phone ?? "", slot: v.slot }, "missed") || undefined;
    await onLead(
      v.leadId,
      `Didn't come to the site visit on ${slotLabel(v.slot)}.${emailed ? ` An email asked them to pick another time.` : ""}`,
      { text: `Call ${firstName(v.name)}: missed the site visit, offer another time`, due: today }
    );
  }
  return { ok: true, visit: rowOf({ ...v, status: outcome, outcomeAt: now, ...(rebookSentAt && { rebookSentAt }) }), whatsapp };
}

// ---- Niko's hours ---------------------------------------------------------------------------------------------

/** Takes hours out (away, busy). Hours already booked stay booked. Answers how many were blocked. */
export async function blockSlots(slots: string[], nowMs = Date.now()): Promise<number> {
  const open = new Set(openSlots(nowMs, BOOK_AHEAD_DAYS, 0));
  const want = [...new Set(slots)].filter((k) => open.has(k)).slice(0, 200);
  if (!want.length) return 0;
  const now = new Date(nowMs).toISOString();
  let tx = buyers().transaction();
  for (const slot of want) tx = tx.createIfNotExists({ _id: SLOT_PREFIX + slot, _type: "visitSlot", slot, blocked: true, createdAt: now });
  await tx.commit();
  forgetTaken();
  return want.length;
}

/** Gives blocked hours back (never a booked one). */
export async function unblockSlots(slots: string[]): Promise<number> {
  const ids = [...new Set(slots)].filter((k) => slotStartMs(k) !== null).map((k) => SLOT_PREFIX + k);
  if (!ids.length) return 0;
  const locks = await buyers().fetch<SlotDoc[]>(`*[_id in $ids && blocked == true]{ _id, slot, blocked }`, { ids });
  if (!locks.length) return 0;
  let tx = buyers().transaction();
  for (const lock of locks) tx = tx.delete(lock._id);
  await tx.commit();
  forgetTaken();
  return locks.length;
}

// ---- the site app's list --------------------------------------------------------------------------------------

export async function listVisits(nowMs = Date.now()): Promise<VisitsData> {
  const today = slotKey(nowMs).slice(0, 10);
  const since = slotKey(nowMs - 30 * DAY);
  const { visits, blocked } = await buyers().fetch<{ visits: VisitDoc[]; blocked: string[] }>(
    `{
      "visits": *[_type == "siteVisit" && string::startsWith(_id, $vp) && slot >= $since] | order(slot asc){ ${VISIT_FIELDS} },
      "blocked": *[_type == "visitSlot" && string::startsWith(_id, $sp) && blocked == true && slot >= $from] | order(slot asc).slot
    }`,
    { vp: VISIT_PREFIX, sp: SLOT_PREFIX, since, from: `${today}T00` }
  );
  const rows = visits.map(rowOf);
  return {
    upcoming: rows.filter((r) => slotDay(r.slot) >= today && r.status !== "cancelled"),
    past: rows.filter((r) => slotDay(r.slot) < today || (slotDay(r.slot) >= today && r.status === "cancelled")).reverse(),
    blocked,
    open: openSlots(nowMs, BOOK_AHEAD_DAYS, 0),
    now: new Date(nowMs).toISOString(),
  };
}

// ---- for the daily jobs (lib/siteVisits/jobs.ts) ----------------------------------------------------------------

export interface JobVisit extends VisitRow {
  threadId: string | null;
}

/** Booked visits on one day ("2026-11-13"), earliest first. */
export async function bookedOn(day: string): Promise<JobVisit[]> {
  const docs = await buyers().fetch<VisitDoc[]>(
    `*[_type == "siteVisit" && string::startsWith(_id, $vp) && status == "booked" && slot >= $from && slot <= $to] | order(slot asc){ ${VISIT_FIELDS} }`,
    { vp: VISIT_PREFIX, from: `${day}T00`, to: `${day}T23` }
  );
  return docs.map((d) => ({ ...rowOf(d), threadId: d.threadId ?? null }));
}

/** The reminder the day before, by email (when they gave one). True when it went out. */
export async function emailReminder(id: string): Promise<boolean> {
  const v = await readVisit(id);
  if (!v || v.status !== "booked" || v.remindedAt) return false;
  return sendVisitEmail("reminder", v);
}

export async function markReminded(id: string, by: string): Promise<void> {
  await buyers()
    .patch(id)
    .set({ remindedAt: new Date().toISOString(), remindedBy: by })
    .commit()
    .catch((e: Error) => console.error("[visits] reminder not marked:", e.message));
}

/** Small state for the daily jobs (which day's digest and nudge went out), so a second run in the hour does nothing. */
export async function jobState(): Promise<{ id: string; digest?: string; reminders?: string; nudge?: string }> {
  const id = LIVE ? "visitJobs-live" : "visitJobs-dev";
  const doc = await buyers().getDocument<{ digest?: string; reminders?: string; nudge?: string }>(id);
  return { id, ...(doc ?? {}) };
}

export async function saveJobState(id: string, set: Record<string, string>): Promise<void> {
  await buyers().createIfNotExists({ _id: id, _type: "visitJobs" });
  await buyers().patch(id).set(set).commit();
}
