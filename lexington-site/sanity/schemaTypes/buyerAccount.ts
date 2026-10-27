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
      name: "role",
      title: "Role",
      description:
        'Leave as Buyer for customers. "Admin" accounts sign in at the normal login page but land in the admin area (CRM) and have no unit or payments. "Site app only" is for the foreman or a storekeeper: the login opens the site app (/todo) and nothing else -- the to-do list and/or the store room, as ticked below.',
      type: "string",
      options: {
        list: [
          { title: "Buyer", value: "buyer" },
          { title: "Admin", value: "admin" },
          { title: "Site app only", value: "site" },
        ],
        layout: "radio",
      },
      initialValue: "buyer",
    }),
    defineField({
      name: "siteAccess",
      title: "Opens",
      description: "Which parts of the site app this login opens (also set from the app: ☰ → Site logins). Logins made before this field existed open both.",
      type: "array",
      of: [{ type: "string" }],
      options: {
        list: [
          { title: "To-do list", value: "todo" },
          { title: "Store room", value: "store" },
        ],
      },
      hidden: ({ document }) => document?.role !== "site",
    }),
    defineField({
      name: "unitNumber",
      title: "Unit number",
      type: "string",
      description: 'Must match a real unit\'s "Unit number" exactly, e.g. "302A". Not a reference — units live in a different dataset.',
      hidden: ({ document }) => document?.role === "admin" || document?.role === "site",
      validation: (Rule) =>
        Rule.custom((value, context) =>
          context.document?.role === "admin" || context.document?.role === "site" || value ? true : "Required for buyers"
        ),
    }),
    defineField({
      name: "contractPriceUSD",
      title: "Contract price (USD)",
      description: "This buyer's actual agreed price, which may differ from the public list price. Balance is calculated as this minus the sum of payments below.",
      type: "number",
      hidden: ({ document }) => document?.role === "admin" || document?.role === "site",
      validation: (Rule) =>
        Rule.custom((value, context) =>
          context.document?.role === "admin" || context.document?.role === "site" || (typeof value === "number" && value > 0)
            ? true
            : "Required for buyers (must be positive)"
        ),
    }),
    defineField({
      name: "listPriceUSD",
      title: "Advertised price (USD)",
      description: "Optional. The price before this buyer's discount. When it is higher than the contract price, the buyer's dashboard shows the advertised price, the discount and the saving.",
      type: "number",
      hidden: ({ document }) => document?.role === "admin" || document?.role === "site",
      validation: (Rule) => Rule.positive(),
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
    defineField({
      name: "contractDraft",
      title: "Draft agreement and next steps",
      description:
        "While set, the buyer's dashboard shows the next steps and a form for their own details. When they send it, the markers in the fill-in copy are filled with their answers and the result replaces the draft.",
      type: "object",
      hidden: ({ document }) => document?.role === "admin" || document?.role === "site",
      fields: [
        defineField({ name: "label", title: "Label", type: "string" }),
        defineField({ name: "current", title: "Draft (what the buyer downloads)", type: "file" }),
        defineField({ name: "fillBase", title: "Fill-in copy (markers where the buyer's details go)", type: "file" }),
        defineField({ name: "paymentStep", title: "Last step: payment (text shown to the buyer)", type: "string" }),
        defineField({ name: "detailsAddedAt", title: "Buyer's details added", type: "datetime", readOnly: true }),
      ],
    }),
    defineField({
      name: "buyerDetails",
      title: "Details the buyer sent from the portal",
      type: "object",
      readOnly: true,
      hidden: ({ document }) => document?.role === "admin" || document?.role === "site",
      fields: [
        defineField({ name: "citizenOfGhana", title: "Citizen of Ghana", type: "boolean" }),
        defineField({ name: "otherCitizenship", title: "Other citizenship", type: "string" }),
        defineField({ name: "idType", title: "ID document", type: "string" }),
        defineField({ name: "idNumber", title: "ID number", type: "string" }),
        defineField({ name: "idCountry", title: "Passport issued by", type: "string" }),
        defineField({ name: "address", title: "Home address", type: "text" }),
        defineField({ name: "emergencyName", title: "Emergency contact", type: "string" }),
        defineField({ name: "emergencyRelationship", title: "Relationship", type: "string" }),
        defineField({ name: "emergencyAddress", title: "Emergency contact address", type: "text" }),
        defineField({ name: "emergencyEmail", title: "Emergency contact email", type: "string" }),
        defineField({ name: "emergencyPhone", title: "Emergency contact phone", type: "string" }),
        defineField({ name: "comments", title: "Questions or changes to the agreement", type: "text" }),
        defineField({ name: "submittedAt", title: "Sent", type: "datetime" }),
      ],
    }),
  ],
  preview: {
    select: { title: "email", subtitle: "unitNumber" },
  },
});
