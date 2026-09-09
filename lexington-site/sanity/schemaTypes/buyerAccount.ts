import { defineArrayMember, defineField, defineType } from "sanity";

const payment = {
  name: "payment",
  title: "Payment",
  type: "object",
  fields: [
    defineField({
      name: "amount",
      title: "Amount",
      description: "The amount actually paid, in the currency selected below.",
      type: "number",
      validation: (Rule) => Rule.required().positive(),
    }),
    defineField({
      name: "currency",
      title: "Currency",
      type: "string",
      options: {
        list: [
          { title: "GHS (Cedis)", value: "GHS" },
          { title: "USD (Dollars)", value: "USD" },
        ],
        layout: "radio",
      },
      initialValue: "GHS",
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "exchangeRate",
      title: "Exchange rate (GHS per USD)",
      description:
        "The rate on the day of payment, e.g. 15.5 -- used to work out the USD equivalent shown on the buyer's dashboard. Enter whatever rate was actually used for this payment (your bank's rate, not necessarily the market mid-rate). Not needed if paid in USD.",
      type: "number",
      validation: (Rule) => Rule.positive(),
      hidden: ({ parent }: { parent?: { currency?: string } }) => parent?.currency !== "GHS",
    }),
    defineField({ name: "date", title: "Date", type: "date" }),
    defineField({
      name: "method",
      title: "Method",
      type: "string",
      options: {
        list: [
          { title: "Cash", value: "cash" },
          { title: "Momo", value: "momo" },
          { title: "Bank Transfer", value: "bank-transfer" },
        ],
      },
    }),
    defineField({ name: "note", title: "Note", type: "string" }),
  ],
  preview: {
    select: { amount: "amount", currency: "currency", date: "date" },
    prepare({ amount, currency, date }: { amount?: number; currency?: string; date?: string }) {
      const symbol = currency === "USD" ? "$" : "GH₵";
      return {
        title: amount ? `${symbol}${amount.toLocaleString()}` : "Payment",
        subtitle: date,
      };
    },
  },
};

const signedAgreement = {
  name: "signedAgreement",
  title: "Signed agreement",
  type: "object",
  fields: [
    defineField({ name: "label", title: "Label", type: "string", validation: (Rule) => Rule.required() }),
    defineField({ name: "file", title: "File", type: "file", validation: (Rule) => Rule.required() }),
  ],
  preview: {
    select: { title: "label" },
  },
};

export const buyerAccount = defineType({
  name: "buyerAccount",
  title: "Buyer account",
  type: "document",
  fields: [
    defineField({
      name: "email",
      title: "Email",
      type: "string",
      description: "Login email. Stored and compared lowercase.",
      validation: (Rule) => Rule.required().email(),
    }),
    defineField({
      name: "passwordHash",
      title: "Password hash",
      type: "string",
      readOnly: true,
      description: "Set only via /admin — never edit this directly.",
    }),
    defineField({ name: "name", title: "Name", type: "string", validation: (Rule) => Rule.required() }),
    defineField({
      name: "unitNumber",
      title: "Unit number",
      type: "string",
      description: 'Must match a real unit\'s "Unit number" exactly, e.g. "302A". Not a reference — units live in a different dataset.',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "contractPriceUSD",
      title: "Contract price (USD)",
      description: "This buyer's actual agreed price, which may differ from the public list price. Balance is calculated as this minus the sum of payments below.",
      type: "number",
      validation: (Rule) => Rule.required().positive(),
    }),
    defineField({
      name: "payments",
      title: "Payments",
      type: "array",
      of: [defineArrayMember(payment)],
    }),
    defineField({
      name: "signedAgreements",
      title: "Signed agreements",
      type: "array",
      of: [defineArrayMember(signedAgreement)],
    }),
  ],
  preview: {
    select: { title: "email", subtitle: "unitNumber" },
  },
});
