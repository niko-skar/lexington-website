import { defineArrayMember, defineField, defineType } from "sanity";

import { PAYMENT_PREFS, SOURCES, STAGES } from "../../lib/crm";

const task = {
  name: "leadTask",
  title: "Task",
  type: "object",
  fields: [
    defineField({ name: "text", title: "What", type: "string", validation: (Rule) => Rule.required() }),
    defineField({ name: "due", title: "Due date", type: "date" }),
    defineField({
      name: "waitingOn",
      title: "Who has to act",
      type: "string",
      options: {
        list: [
          { title: "Me", value: "me" },
          { title: "Them", value: "them" },
        ],
        layout: "radio",
      },
      initialValue: "me",
    }),
    defineField({ name: "done", title: "Done", type: "boolean", initialValue: false }),
    defineField({ name: "createdAt", title: "Created", type: "datetime", readOnly: true }),
    defineField({ name: "doneAt", title: "Done at", type: "datetime", readOnly: true }),
  ],
  preview: {
    select: { title: "text", subtitle: "due", done: "done" },
    prepare({ title, subtitle, done }: { title?: string; subtitle?: string; done?: boolean }) {
      return { title: `${done ? "✓ " : ""}${title ?? ""}`, subtitle };
    },
  },
};

const note = {
  name: "leadNote",
  title: "Note",
  type: "object",
  fields: [
    defineField({ name: "at", title: "When", type: "datetime" }),
    defineField({
      name: "kind",
      title: "Kind",
      type: "string",
      options: {
        list: [
          { title: "Note", value: "note" },
          { title: "Stage change", value: "stage" },
          { title: "System", value: "system" },
        ],
      },
      initialValue: "note",
    }),
    defineField({ name: "text", title: "Text", type: "text", rows: 2 }),
  ],
  preview: {
    select: { title: "text", subtitle: "at" },
  },
};

// Prospects (CRM). The working screens live at /admin/crm -- this type exists
// so the same records can be inspected or fixed in Studio as a backup view.
export const lead = defineType({
  name: "lead",
  title: "Prospect",
  type: "document",
  fields: [
    defineField({ name: "name", title: "Name", type: "string", validation: (Rule) => Rule.required() }),
    defineField({ name: "phone", title: "WhatsApp / phone", type: "string" }),
    defineField({ name: "email", title: "Email", type: "string" }),
    defineField({
      name: "source",
      title: "Where they came from",
      type: "string",
      options: { list: SOURCES.map((s) => ({ title: s.label, value: s.key })) },
    }),
    defineField({
      name: "stage",
      title: "Stage",
      type: "string",
      options: { list: STAGES.map((s) => ({ title: s.label, value: s.key })) },
      initialValue: "new",
      validation: (Rule) => Rule.required(),
    }),
    defineField({ name: "lostReason", title: "Why lost", type: "string" }),
    defineField({ name: "interest", title: "What they asked about", type: "string" }),
    defineField({ name: "unitNumber", title: "Unit", type: "string", description: 'e.g. "205B"' }),
    defineField({
      name: "paymentPreference",
      title: "Payment",
      type: "string",
      options: { list: PAYMENT_PREFS.map((p) => ({ title: p.label, value: p.key })) },
    }),
    defineField({ name: "agreedPriceUSD", title: "Agreed price (USD)", type: "number" }),
    defineField({ name: "buyerAccountId", title: "Buyer login (id)", type: "string", readOnly: true }),
    defineField({ name: "tasks", title: "Tasks", type: "array", of: [defineArrayMember(task)] }),
    defineField({ name: "notes", title: "Notes", type: "array", of: [defineArrayMember(note)] }),
  ],
  preview: {
    select: { title: "name", subtitle: "stage" },
  },
});
