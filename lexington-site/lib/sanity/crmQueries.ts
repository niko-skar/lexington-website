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
    metaPlatform,
    adSource,
    metaInboxUrl,
    "chatChannel": *[_type == "chatThread" && _id == ^.chatThread][0].channel,
    "context": coalesce(notes[kind == "note"][-1].text, notes[0].text)
  }
`);

// A prospect's page: the prospect, their chat with the assistant, and the others with a phone number (the page looks
// for the same number written another way). One request.
export const prospectPageQuery = defineQuery(`{
  "lead": *[_type == "lead" && _id == $id][0],
  "thread": *[_type == "chatThread" && _id == *[_type == "lead" && _id == $id][0].chatThread][0]{ _id, channel, senderId, inboxUrl },
  "others": *[_type == "lead" && _id != $id && defined(phone)]{
    _id, name, phone, source, stage, metaPlatform, metaInboxUrl, adSource,
    "thread": *[_type == "chatThread" && _id == ^.chatThread][0]{ _id, channel, senderId, inboxUrl }
  }
}`);

export const leadByIdQuery = defineQuery(`
  *[_type == "lead" && _id == $id][0]
`);

export const leadByEmailQuery = defineQuery(`
  *[_type == "lead" && lower(email) == $email][0]{ _id, name, stage }
`);
