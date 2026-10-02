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
    defineField({
      name: "emailedAt",
      title: "Emailed to the buyer",
      description: "Set when the receipt has been emailed. Receipts for new payments go out automatically a few minutes after the payment is recorded.",
      type: "datetime",
    }),
    defineField({ name: "emailedTo", title: "Emailed to (address)", type: "string" }),
    defineField({
      name: "skipEmail",
      title: "Don't email",
      description: "Set on receipts for payments that were recorded before automatic emailing began.",
      type: "boolean",
    }),
    defineField({ name: "emailClaimedAt", title: "Email in progress since", type: "datetime" }),
    defineField({ name: "emailAttempts", title: "Failed email attempts", type: "number" }),
    defineField({ name: "emailError", title: "Last email error", type: "string" }),
  ],
  preview: {
    select: { title: "number", issued: "issuedAt", emailed: "emailedAt", skip: "skipEmail" },
    prepare({ title, issued, emailed, skip }: { title?: string; issued?: string; emailed?: string; skip?: boolean }) {
      const status = emailed ? "emailed" : skip ? "not emailed" : "email pending";
      return { title, subtitle: `${issued ? issued.slice(0, 10) : ""} · ${status}` };
    },
  },
});
