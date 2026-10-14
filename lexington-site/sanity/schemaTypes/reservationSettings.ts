import { defineArrayMember, defineField, defineType } from "sanity";

// A singleton (fixed _id "reservationSettings", see sanity/buyersStructure.ts).
// It lives in the PRIVATE buyers dataset on purpose: these are the bank details
// that go onto the reservation fee form the website emails to people, and they
// must never be in the code or in the publicly-readable dataset.
export const reservationSettings = defineType({
  name: "reservationSettings",
  title: "Reservation form settings",
  type: "document",
  fields: [
    defineField({
      name: "autoSend",
      title: "Email the form automatically",
      description:
        "On: when someone finishes the reservation questions on the website, the reservation fee form is emailed to them straight away. Off: nothing goes out by itself. They are told an advisor will send it, and you get the form by email to send yourself. Until all five bank lines below are filled in, nothing is emailed either. After any change, press Publish (bottom right): the website only uses what is published.",
      type: "boolean",
      initialValue: true,
    }),
    defineField({
      name: "accountOwner",
      title: "Account owner",
      description: "Name on the bank account, exactly as the bank has it.",
      type: "string",
    }),
    defineField({ name: "bankName", title: "Bank name", type: "string" }),
    defineField({ name: "accountNumber", title: "Account number", type: "string" }),
    defineField({ name: "routingNumber", title: "Routing number", type: "string" }),
    defineField({
      name: "accountAddress",
      title: "Account address",
      description: "The address the bank holds for the account.",
      type: "string",
    }),
    defineField({
      name: "extraLines",
      title: "Extra lines on the form",
      description:
        "Optional, up to 3 (the form has room for no more). For example the SWIFT code or the bank's own address for international wires. Each line is printed under the account address.",
      type: "array",
      validation: (Rule) => Rule.max(3),
      of: [
        defineArrayMember({
          type: "object",
          name: "extraLine",
          fields: [
            defineField({ name: "label", title: "Label", type: "string", validation: (Rule) => Rule.required() }),
            defineField({ name: "value", title: "Value", type: "string", validation: (Rule) => Rule.required() }),
          ],
          preview: { select: { title: "label", subtitle: "value" } },
        }),
      ],
    }),
    defineField({
      name: "paymentReference",
      title: "What the buyer should write as the payment reference",
      description: "Printed on the form. Leave empty to use: Your full name and the unit number.",
      type: "string",
    }),
  ],
  preview: {
    select: { auto: "autoSend", bank: "bankName" },
    prepare({ auto, bank }: { auto?: boolean; bank?: string }) {
      return {
        title: "Reservation form settings",
        subtitle: `${auto === false ? "Held: not emailed automatically" : "Emailed automatically"}${bank ? ` · ${bank}` : ""}`,
      };
    },
  },
});
