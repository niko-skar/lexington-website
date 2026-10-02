import { defineField, defineType } from "sanity";

// One document per payment receipt that has been issued. They're created by the
// site the first time a payment's receipt is needed, never by hand -- the
// receipt number must stay the same forever once a buyer has it, which is why
// it lives here and not on the (editable) payment row.
export const receipt = defineType({
  name: "receipt",
  title: "Receipt",
  type: "document",
  readOnly: true,
  fields: [
    defineField({ name: "number", title: "Receipt number", type: "string" }),
    defineField({ name: "buyerId", title: "Buyer account id", type: "string" }),
    defineField({ name: "paymentKey", title: "Payment id", type: "string" }),
    defineField({ name: "issuedAt", title: "Issued", type: "datetime" }),
  ],
  preview: {
    select: { title: "number", subtitle: "issuedAt" },
  },
});
