import { defineQuery } from "next-sanity";

// Lists don't need the notes timeline, which can get long.
export const leadsListQuery = defineQuery(`
  *[_type == "lead"] | order(_createdAt desc) {
    _id,
    _createdAt,
    _updatedAt,
    name,
    phone,
    email,
    source,
    stage,
    lostReason,
    interest,
    unitNumber,
    paymentPreference,
    agreedPriceUSD,
    buyerAccountId,
    tasks,
    "context": coalesce(notes[kind == "note"][-1].text, notes[0].text)
  }
`);

export const leadByIdQuery = defineQuery(`
  *[_type == "lead" && _id == $id][0]
`);

export const leadByEmailQuery = defineQuery(`
  *[_type == "lead" && lower(email) == $email][0]{ _id, name, stage }
`);
