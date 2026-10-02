import "server-only";
import { randomUUID } from "node:crypto";

import { firstName, todayISO } from "@/lib/crm";
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
        .patch(existing._id, (p) => {
          const next = p.append("tasks", [task]).append("notes", [entry]);
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
