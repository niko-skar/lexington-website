import { SLOT_RE } from "@/lib/siteVisits/shared";
import { blockSlots, bookVisit, cancelVisit, changeVisit, listVisits, markVisit, unblockSlots, whatsappNote } from "@/lib/siteVisits/store";
import { TodoError, errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/site-visits: the visits (today on, and the last 30 days), the hours blocked and the hours open. The office only. */
export async function GET(): Promise<Response> {
  try {
    await requireTodoUser(true, "visits");
    return Response.json(await listVisits(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const slots = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && SLOT_RE.test(x)).slice(0, 200) : []);

/**
 * POST /api/site-visits { action, ... }, the office only:
 * - "came" / "missed" { id }: after the visit ("missed" emails them to pick another time);
 * - "cancel" { id }: lets the hour go and tells them;
 * - "move" { id, slot }: a new time (they are told);
 * - "add" { slot, name, phone, email?, people?, note? }: a visit booked by phone;
 * - "block" / "unblock" { slots }: hours Niko can't show anyone.
 * Answers { ok, data (the list again), whatsapp? (a message to send by hand when there is no email) }.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    await requireTodoUser(true, "visits");
    const body = await readJson(request);
    const action = str(body.action, 20);
    const id = str(body.id, 40);
    let whatsapp: string | undefined;
    if (action === "came" || action === "missed") {
      const r = await markVisit(id, action);
      if (!r.ok) throw new TodoError(400, "That visit can't be marked (it hasn't happened yet, or it was cancelled).");
      whatsapp = r.whatsapp;
    } else if (action === "cancel") {
      const r = await cancelVisit(id, "office");
      if (!r.ok) throw new TodoError(400, "That visit couldn't be cancelled. Try again.");
      whatsapp = r.whatsapp;
    } else if (action === "move") {
      const slot = str(body.slot, 20);
      if (!SLOT_RE.test(slot)) throw new TodoError(400, "Pick a new time.");
      const r = await changeVisit(id, slot, "office");
      if (!r.ok) throw new TodoError(400, r.reason === "taken" ? "That time has just been booked. Pick another." : r.reason === "closed" ? "That time can't be booked (too soon, or outside the visiting hours)." : "That visit couldn't be moved.");
    } else if (action === "add") {
      const slot = str(body.slot, 20);
      const name = str(body.name, 120);
      const phone = str(body.phone, 40);
      if (!SLOT_RE.test(slot)) throw new TodoError(400, "Pick a time.");
      if (name.length < 2) throw new TodoError(400, "Type their name.");
      const people = Number(body.people);
      const r = await bookVisit({
        slot,
        name,
        phone,
        email: str(body.email, 160).toLowerCase(),
        people: Number.isInteger(people) && people > 0 ? people : null,
        interest: "",
        note: str(body.note, 1000),
        source: "office",
      });
      if (!r.ok) throw new TodoError(400, r.reason === "taken" ? "That time has just been booked. Pick another." : r.reason === "closed" ? "That time can't be booked (too soon, or outside the visiting hours)." : "The visit couldn't be saved. Try again.");
      // No email to confirm it by: a WhatsApp message, written, to send in one tap.
      if (!r.emailed && phone) whatsapp = whatsappNote({ name, phone, slot }, "booked");
    } else if (action === "block") {
      await blockSlots(slots(body.slots));
    } else if (action === "unblock") {
      await unblockSlots(slots(body.slots));
    } else {
      throw new TodoError(400, "Unknown action.");
    }
    return Response.json({ ok: true, data: await listVisits(), ...(whatsapp && { whatsapp }) });
  } catch (error) {
    return errorResponse(error);
  }
}
