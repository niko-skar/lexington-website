"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Patch } from "@sanity/client";

import { createBuyerAccountRecord } from "@/lib/auth/buyerAccountsCore";
import { getAdminSession } from "@/lib/auth/session";
import { PAYMENT_PREFS, SOURCES, STAGES, addDaysISO, firstName, stageLabel, todayISO } from "@/lib/crm";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { leadByEmailQuery } from "@/lib/sanity/crmQueries";

export interface CrmFormState {
  status: "idle" | "success" | "error";
  message: string;
  /** Id of the prospect the message is about, so the form can link to it. */
  id?: string;
  /** Shown once so Niko can pass it on -- never stored, never logged. */
  generatedPassword?: string;
}

const ID_RE = /^[A-Za-z0-9_.-]{1,80}$/;
const KEY_RE = /^[A-Za-z0-9_-]{1,40}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STAGE_KEYS: string[] = STAGES.map((s) => s.key);
const SOURCE_KEYS: string[] = SOURCES.map((s) => s.key);
const PAYMENT_KEYS: string[] = PAYMENT_PREFS.map((p) => p.key);
// Stages before "Reserved" -- creating a buyer login moves a prospect up to it.
const BEFORE_RESERVED = ["new", "contacted", "viewing", "contract"];

const newKey = () => randomUUID().replace(/-/g, "").slice(0, 12);
const field = (formData: FormData, name: string, max = 200) =>
  String(formData.get(name) || "").trim().slice(0, max);
const fail = (message: string): CrmFormState => ({ status: "error", message });
const note = (kind: "note" | "stage" | "system", text: string) => ({
  _key: newKey(),
  at: new Date().toISOString(),
  kind,
  text,
});

// A Server Action can be called directly, so each one checks for itself even
// though proxy.ts already gates /admin/*.
async function guard() {
  if (!(await getAdminSession())) {
    throw new Error("Not authorized.");
  }
}

function refresh(id?: string) {
  revalidatePath("/admin/crm");
  if (id) revalidatePath(`/admin/crm/${id}`);
}

// Appending to an array that doesn't exist yet fails in Sanity, so make sure
// both arrays are there first (same transaction, applied in order).
async function patchLead(id: string, build: (patch: Patch) => Patch) {
  await getBuyersClient()
    .transaction()
    .patch(id, (p) => p.setIfMissing({ tasks: [], notes: [] }))
    .patch(id, build)
    .commit();
}

function pick(value: string, allowed: string[], fallback: string) {
  return allowed.includes(value) ? value : fallback;
}

// ---- add a prospect --------------------------------------------------

export async function addLeadAction(_prev: CrmFormState, formData: FormData): Promise<CrmFormState> {
  if (!(await getAdminSession())) return fail("Not authorized.");

  const name = field(formData, "name", 120);
  if (!name) return fail("Please enter a name.");
  const phone = field(formData, "phone", 40);
  const email = field(formData, "email", 160).toLowerCase();
  if (email && !email.includes("@")) return fail("That email doesn't look right.");
  const source = pick(field(formData, "source", 30), SOURCE_KEYS, "other");
  const unitNumber = field(formData, "unitNumber", 20);
  const nextText = field(formData, "nextStep", 200) || `Reach out to ${firstName(name)}`;
  const dueRaw = field(formData, "due", 10);
  const due = DATE_RE.test(dueRaw) ? dueRaw : todayISO();
  const now = new Date().toISOString();

  try {
    const client = getBuyersClient();
    if (email) {
      const existing = await client.fetch<{ _id: string; name: string } | null>(leadByEmailQuery, { email });
      if (existing) {
        return { status: "error", message: `${existing.name} already has this email.`, id: existing._id };
      }
    }

    const doc = await client.create({
      _type: "lead",
      name,
      ...(phone && { phone }),
      ...(email && { email }),
      source,
      stage: "new",
      ...(unitNumber && { unitNumber }),
      paymentPreference: "undecided",
      tasks: [{ _key: newKey(), text: nextText, due, waitingOn: "me", done: false, createdAt: now }],
      notes: [note("system", "Added manually.")],
    });

    refresh();
    return { status: "success", message: `Added ${name}.`, id: doc._id };
  } catch (err) {
    console.error("Failed to add prospect:", err);
    return fail("Something went wrong adding the prospect.");
  }
}

// ---- stage -----------------------------------------------------------

export async function setStageAction(formData: FormData) {
  await guard();
  const id = field(formData, "leadId", 80);
  const stage = field(formData, "stage", 30);
  const reason = field(formData, "lostReason", 80);
  const fromRaw = field(formData, "fromStage", 30);
  if (!ID_RE.test(id) || !STAGE_KEYS.includes(stage)) throw new Error("Bad request.");

  // The screen already knows where the prospect is, so it sends that along and
  // we skip a round trip to Sanity (it only feeds the timeline note).
  let from: string | undefined = STAGE_KEYS.includes(fromRaw) ? fromRaw : undefined;
  if (!from) {
    const current = await getBuyersClient().fetch<{ stage?: string } | null>(
      `*[_type == "lead" && _id == $id][0]{ stage }`,
      { id }
    );
    if (!current) throw new Error("Prospect not found.");
    from = current.stage ?? "new";
  }
  if (from === stage) return;

  const text =
    stage === "lost"
      ? `Marked lost${reason ? `: ${reason}` : ""}`
      : `Moved: ${stageLabel(from)} → ${stageLabel(stage)}`;

  await patchLead(id, (p) =>
    (stage === "lost"
      ? p.set({ stage, lostReason: reason || "Other" })
      : p.set({ stage }).unset(["lostReason"])
    ).append("notes", [note("stage", text)])
  );
  refresh(id);
}

// ---- details ---------------------------------------------------------

export async function updateLeadAction(_prev: CrmFormState, formData: FormData): Promise<CrmFormState> {
  if (!(await getAdminSession())) return fail("Not authorized.");

  const id = field(formData, "leadId", 80);
  if (!ID_RE.test(id)) return fail("Missing prospect.");
  const name = field(formData, "name", 120);
  if (!name) return fail("Please enter a name.");
  const email = field(formData, "email", 160).toLowerCase();
  if (email && !email.includes("@")) return fail("That email doesn't look right.");

  const priceRaw = field(formData, "agreedPriceUSD", 20).replace(/[,\s$]/g, "");
  const price = priceRaw ? Number(priceRaw) : undefined;
  if (price !== undefined && (!Number.isFinite(price) || price <= 0)) {
    return fail("The agreed price must be a positive number.");
  }

  const values = {
    name,
    phone: field(formData, "phone", 40),
    email,
    source: pick(field(formData, "source", 30), SOURCE_KEYS, "other"),
    interest: field(formData, "interest", 120),
    unitNumber: field(formData, "unitNumber", 20),
    paymentPreference: pick(field(formData, "paymentPreference", 20), PAYMENT_KEYS, "undecided"),
  };

  try {
    await patchLead(id, (p) => {
      const next = p.set(values);
      return price === undefined ? next.unset(["agreedPriceUSD"]) : next.set({ agreedPriceUSD: price });
    });
    refresh(id);
    return { status: "success", message: "Saved.", id };
  } catch (err) {
    console.error("Failed to update prospect:", err);
    return fail("Something went wrong saving.");
  }
}

// ---- tasks -----------------------------------------------------------

export async function addTaskAction(_prev: CrmFormState, formData: FormData): Promise<CrmFormState> {
  if (!(await getAdminSession())) return fail("Not authorized.");

  const id = field(formData, "leadId", 80);
  const text = field(formData, "text", 200);
  if (!ID_RE.test(id)) return fail("Missing prospect.");
  if (!text) return fail("Please say what the next step is.");
  const dueRaw = field(formData, "due", 10);
  const due = DATE_RE.test(dueRaw) ? dueRaw : todayISO();
  const waitingOn = field(formData, "waitingOn", 4) === "them" ? "them" : "me";

  try {
    await patchLead(id, (p) =>
      p.append("tasks", [
        { _key: newKey(), text, due, waitingOn, done: false, createdAt: new Date().toISOString() },
      ])
    );
    refresh(id);
    return { status: "success", message: "Added.", id };
  } catch (err) {
    console.error("Failed to add task:", err);
    return fail("Something went wrong adding that.");
  }
}

export async function completeTaskAction(formData: FormData) {
  await guard();
  const id = field(formData, "leadId", 80);
  const key = field(formData, "taskKey", 40);
  const text = field(formData, "taskText", 200);
  if (!ID_RE.test(id) || !KEY_RE.test(key)) throw new Error("Bad request.");

  const now = new Date().toISOString();
  await patchLead(id, (p) =>
    p
      .set({ [`tasks[_key=="${key}"].done`]: true, [`tasks[_key=="${key}"].doneAt`]: now })
      .append("notes", [note("system", `Done: ${text || "task"}`)])
  );
  refresh(id);
}

export async function snoozeTaskAction(formData: FormData) {
  await guard();
  const id = field(formData, "leadId", 80);
  const key = field(formData, "taskKey", 40);
  const days = Number(field(formData, "days", 2));
  if (!ID_RE.test(id) || !KEY_RE.test(key) || ![1, 3, 7].includes(days)) throw new Error("Bad request.");

  await patchLead(id, (p) =>
    p.set({ [`tasks[_key=="${key}"].due`]: addDaysISO(todayISO(), days) })
  );
  refresh(id);
}

export async function deleteTaskAction(formData: FormData) {
  await guard();
  const id = field(formData, "leadId", 80);
  const key = field(formData, "taskKey", 40);
  if (!ID_RE.test(id) || !KEY_RE.test(key)) throw new Error("Bad request.");

  await patchLead(id, (p) => p.unset([`tasks[_key=="${key}"]`]));
  refresh(id);
}

// ---- notes -----------------------------------------------------------

export async function addNoteAction(_prev: CrmFormState, formData: FormData): Promise<CrmFormState> {
  if (!(await getAdminSession())) return fail("Not authorized.");

  const id = field(formData, "leadId", 80);
  const text = field(formData, "text", 2000);
  if (!ID_RE.test(id)) return fail("Missing prospect.");
  if (!text) return fail("Write something first.");

  try {
    await patchLead(id, (p) => p.append("notes", [note("note", text)]));
    refresh(id);
    return { status: "success", message: "Note added.", id };
  } catch (err) {
    console.error("Failed to add note:", err);
    return fail("Something went wrong adding the note.");
  }
}

// ---- delete ----------------------------------------------------------

export async function deleteLeadAction(formData: FormData) {
  await guard();
  const id = field(formData, "leadId", 80);
  if (!ID_RE.test(id)) throw new Error("Bad request.");

  // Only the prospect goes -- a buyer login created from it is left alone.
  await getBuyersClient().delete(id);
  refresh();
  redirect("/admin/crm?view=all");
}

// ---- buyer login -----------------------------------------------------

export async function createBuyerFromLeadAction(
  _prev: CrmFormState,
  formData: FormData
): Promise<CrmFormState> {
  if (!(await getAdminSession())) return fail("Not authorized.");

  const id = field(formData, "leadId", 80);
  const email = field(formData, "email", 160).toLowerCase();
  const name = field(formData, "name", 120);
  const unitNumber = field(formData, "unitNumber", 20);
  const price = Number(field(formData, "contractPriceUSD", 20).replace(/[,\s$]/g, ""));
  const customPassword = field(formData, "password", 100);

  if (!ID_RE.test(id)) return fail("Missing prospect.");
  if (!email || !email.includes("@") || !name || !unitNumber || !Number.isFinite(price) || price <= 0) {
    return fail("Please fill in the email, name, unit and a valid contract price.");
  }

  try {
    const current = await getBuyersClient().fetch<{ stage?: string } | null>(
      `*[_type == "lead" && _id == $id][0]{ stage }`,
      { id }
    );
    if (!current) return fail("Prospect not found.");

    const result = await createBuyerAccountRecord({
      email,
      name,
      unitNumber,
      contractPriceUSD: price,
      password: customPassword || undefined,
    });
    if (!result.ok) return fail(result.message);

    await patchLead(id, (p) => {
      const next = p.set({ buyerAccountId: result.id, email, unitNumber, agreedPriceUSD: price });
      return (BEFORE_RESERVED.includes(current.stage ?? "new") ? next.set({ stage: "reserved" }) : next).append(
        "notes",
        [note("system", `Buyer login created for ${email} (unit ${unitNumber}).`)]
      );
    });

    revalidatePath("/admin");
    refresh(id);
    return {
      status: "success",
      message: `Buyer login created for ${email}.`,
      id,
      generatedPassword: result.password,
    };
  } catch (err) {
    console.error("Failed to create buyer login from prospect:", err);
    return fail("Something went wrong creating the login.");
  }
}
