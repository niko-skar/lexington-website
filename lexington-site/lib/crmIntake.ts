import "server-only";
import { randomUUID } from "node:crypto";

import { addDaysISO, firstName, todayISO } from "@/lib/crm";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { leadByEmailQuery } from "@/lib/sanity/crmQueries";

const newKey = () => randomUUID().replace(/-/g, "").slice(0, 12);

interface WebsiteEnquiry {
  name: string;
  email: string;
  phone: string;
  unit: string;
  message: string;
}

// Saves a website enquiry as a prospect (or adds to the existing one with the
// same email) and returns its id for the "Open in CRM" link. Never throws: a
// problem here must not stop the enquiry email from going out.
export async function saveWebsiteLead(input: WebsiteEnquiry): Promise<string | null> {
  try {
    const client = getBuyersClient();
    const name = input.name.slice(0, 120);
    const email = input.email.toLowerCase().slice(0, 160);
    const phone = input.phone.slice(0, 40);
    const unit = input.unit.slice(0, 120);
    const message = input.message.slice(0, 2000);
    const now = new Date().toISOString();

    const what = unit ? ` about ${unit}` : "";
    const said = message ? `: ${message}` : " (no message)";

    const existing = await client.fetch<{ _id: string; stage?: string } | null>(leadByEmailQuery, { email });

    if (existing) {
      const task = {
        _key: newKey(),
        text: `Reply to ${firstName(name)}'s new enquiry`,
        due: todayISO(),
        waitingOn: "me",
        done: false,
        createdAt: now,
      };
      const entry = { _key: newKey(), at: now, kind: "system", text: `Enquired again on the website${what}${said}` };

      await client
        .transaction()
        .patch(existing._id, (p) => p.setIfMissing({ tasks: [], notes: [] }))
        // One append per patch: two on the same patch overwrite each other and only the last is kept.
        .patch(existing._id, (p) => p.append("tasks", [task]))
        .patch(existing._id, (p) => {
          const next = p.append("notes", [entry]);
          // Someone written off who comes back is a live prospect again.
          return existing.stage === "lost" ? next.set({ stage: "new" }).unset(["lostReason"]) : next;
        })
        .commit();
      return existing._id;
    }

    const doc = await client.create({
      _type: "lead",
      name,
      email,
      ...(phone && { phone }),
      source: "website",
      stage: "new",
      ...(unit && { interest: unit }),
      paymentPreference: "undecided",
      tasks: [
        {
          _key: newKey(),
          text: `Reply to ${firstName(name)}'s enquiry`,
          due: todayISO(),
          waitingOn: "me",
          done: false,
          createdAt: now,
        },
      ],
      notes: [{ _key: newKey(), at: now, kind: "system", text: `Website enquiry${what}${said}` }],
    });
    return doc._id;
  } catch (err) {
    console.error("Could not save the website enquiry to the CRM:", err);
    return null;
  }
}

// ---- reservation requests (the "Reserve a residence" flow) ----------------

export interface ReservationLead {
  name: string;
  email: string;
  phone: string;
  /** What to show as "what they asked about", e.g. "Reservation: One Bedroom, unit 205B". */
  interest: string;
  /** A unit number, or "" when they only picked a type. */
  unitNumber: string;
  /** One of the CRM's payment keys (cash / plan / mortgage / undecided). */
  paymentPreference: string;
  /** Used only when this is a brand-new prospect. */
  source: string;
  /** Everything they answered, written out for the notes timeline. */
  summary: string;
  /** The first things Niko has to do (and wait for). */
  tasks: Array<{ text: string; dueInDays: number; waitingOn: "me" | "them" }>;
}

const DAY_MS = 86_400_000;

// How many reservation requests this address has made in the last day. Used to
// stop the same inbox being sent the form again and again. Never throws: if the
// CRM can't be read the request goes ahead (the per-connection limit still applies).
export async function countRecentReservationRequests(emailInput: string): Promise<number> {
  try {
    const email = emailInput.toLowerCase().slice(0, 160);
    const lead = await getBuyersClient().fetch<{ notes?: Array<{ at?: string; text?: string }> } | null>(
      `*[_type == "lead" && lower(email) == $email][0]{ notes }`,
      { email }
    );
    const since = Date.now() - DAY_MS;
    return (lead?.notes ?? []).filter(
      (n) => n.text?.startsWith("Reservation request") && n.at && new Date(n.at).getTime() > since
    ).length;
  } catch (err) {
    console.error("Could not count recent reservation requests:", err);
    return 0;
  }
}

// Saves a reservation request as a prospect (or adds to the existing one with the
// same email) and returns its id. Never throws: a problem here must not stop the
// reservation form being sent.
export async function saveReservationLead(input: ReservationLead): Promise<string | null> {
  try {
    const client = getBuyersClient();
    const name = input.name.slice(0, 120);
    const email = input.email.toLowerCase().slice(0, 160);
    const phone = input.phone.slice(0, 40);
    const now = new Date().toISOString();
    const today = todayISO();

    const tasks = input.tasks.map((t) => ({
      _key: newKey(),
      text: t.text.slice(0, 200),
      due: addDaysISO(today, t.dueInDays),
      waitingOn: t.waitingOn,
      done: false,
      createdAt: now,
    }));
    const entry = { _key: newKey(), at: now, kind: "system" as const, text: input.summary.slice(0, 3000) };

    const existing = await client.fetch<{ _id: string; stage?: string; paymentPreference?: string } | null>(
      `*[_type == "lead" && lower(email) == $email][0]{ _id, stage, paymentPreference }`,
      { email }
    );

    if (existing) {
      const wantsPayment = input.paymentPreference && input.paymentPreference !== "undecided";
      await client
        .transaction()
        .patch(existing._id, (p) => p.setIfMissing({ tasks: [], notes: [] }))
        // One append per patch (see saveWebsiteLead).
        .patch(existing._id, (p) => p.append("tasks", tasks))
        .patch(existing._id, (p) => {
          let next = p.append("notes", [entry]).setIfMissing({ phone }).set({ interest: input.interest.slice(0, 120) });
          if (input.unitNumber) next = next.set({ unitNumber: input.unitNumber.slice(0, 20) });
          if (wantsPayment && (!existing.paymentPreference || existing.paymentPreference === "undecided")) {
            next = next.set({ paymentPreference: input.paymentPreference });
          }
          // Someone written off who comes back is a live prospect again.
          return existing.stage === "lost" ? next.set({ stage: "new" }).unset(["lostReason"]) : next;
        })
        .commit();
      return existing._id;
    }

    const doc = await client.create({
      _type: "lead",
      name,
      email,
      ...(phone && { phone }),
      source: input.source,
      stage: "new",
      interest: input.interest.slice(0, 120),
      ...(input.unitNumber && { unitNumber: input.unitNumber.slice(0, 20) }),
      paymentPreference: input.paymentPreference,
      tasks,
      notes: [entry],
    });
    return doc._id;
  } catch (err) {
    console.error("Could not save the reservation request to the CRM:", err);
    return null;
  }
}

// Adds a line to a prospect's timeline, and optionally one more task. Never throws.
export async function noteOnLead(
  leadId: string,
  text: string,
  task?: { text: string; dueInDays: number; waitingOn: "me" | "them" }
) {
  try {
    const now = new Date().toISOString();
    const entry = { _key: newKey(), at: now, kind: "system" as const, text: text.slice(0, 600) };
    const tx = getBuyersClient()
      .transaction()
      .patch(leadId, (p) => p.setIfMissing({ tasks: [], notes: [] }))
      // One append per patch (see saveWebsiteLead).
      .patch(leadId, (p) => p.append("notes", [entry]));
    await (task
      ? tx.patch(leadId, (p) =>
          p.append("tasks", [
            {
              _key: newKey(),
              text: task.text.slice(0, 200),
              due: addDaysISO(todayISO(), task.dueInDays),
              waitingOn: task.waitingOn,
              done: false,
              createdAt: now,
            },
          ])
        )
      : tx
    ).commit();
  } catch (err) {
    console.error("Could not add a note to the prospect:", err);
  }
}
