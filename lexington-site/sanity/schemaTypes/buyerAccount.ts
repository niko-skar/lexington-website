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

const nextStep = {
  name: "nextStep",
  title: "Step",
  type: "object",
  fields: [
    defineField({ name: "title", title: "Step", type: "string", validation: (Rule) => Rule.required() }),
    defineField({ name: "text", title: "What the buyer reads", type: "text", rows: 2 }),
    defineField({
      name: "donePaidUSD",
      title: "Done once paid (US$)",
      description: "Optional. The step ticks itself when the buyer's payments add up to this, e.g. 20000 for a US$20,000 deposit.",
      type: "number",
      validation: (Rule) => Rule.positive(),
    }),
    defineField({ name: "done", title: "Done", type: "boolean", description: "Tick it when it's done (not needed with an amount above)." }),
    defineField({
      name: "link",
      title: "Button",
      type: "string",
      options: {
        list: [
          { title: "Download the draft agreement", value: "draft" },
          { title: "Add their details", value: "details" },
        ],
      },
    }),
  ],
  preview: {
    select: { title: "title", done: "done" },
    prepare({ title, done }: { title?: string; done?: boolean }) {
      return { title: `${done ? "✓ " : ""}${title ?? "Step"}` };
    },
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
      description: "Login email. A site login, or a buyer with no email, may have a username instead (e.g. storekeeper). Stored and compared lowercase.",
      validation: (Rule) =>
        Rule.required().custom((value, context) => {
          if (typeof value !== "string") return true;
          if ((context.document as { role?: string } | undefined)?.role !== "admin" && /^[a-z0-9][a-z0-9._-]{2,29}$/.test(value)) return true;
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || "Must be a valid email address";
        }),
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
      description:
        'Must match a real unit\'s "Unit number" exactly, e.g. "302A". Two or more homes on one account: separate them with commas, e.g. "Studio 1, 204B". Not a reference — units live in a different dataset.',
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
      name: "home3d",
      title: "Show the buyer's home in 3D on their first page",
      description: "When on, the buyer sees the 3D model of their home as soon as they sign in. Only works for a home that has a 3D model on the Residences page.",
      type: "boolean",
      hidden: ({ document }) => document?.role === "admin" || document?.role === "site",
    }),
    defineField({
      name: "paymentPlan",
      title: "Payment plan",
      description:
        "Optional. The buyer's first page and payments page list these payments in order with their due dates, and mark each one paid as the payments come in (they fill the plan from the top). Amounts in US dollars.",
      type: "array",
      of: [
        defineArrayMember({
          type: "object",
          name: "planPayment",
          fields: [
            defineField({ name: "label", title: "What it is", type: "string", validation: (r) => r.required() }),
            defineField({ name: "dueDate", title: "Due by", type: "date", validation: (r) => r.required() }),
            defineField({ name: "amountUSD", title: "Amount (US$)", type: "number", validation: (r) => r.required().positive() }),
          ],
          preview: { select: { title: "label", subtitle: "dueDate" } },
        }),
      ],
      hidden: ({ document }) => document?.role === "admin" || document?.role === "site",
    }),
    defineField({
      name: "soldAtPaidUSD",
      title: "Mark the homes sold when the payments reach (US$)",
      description:
        "Optional. Put the full deposit here. While the payments are below it, keep the account's homes 'reserved' on the website; once they reach it, the homes switch to 'sold' by themselves (within 5 minutes) and you get an alert.",
      type: "number",
      hidden: ({ document }) => document?.role === "admin" || document?.role === "site",
    }),
    defineField({
      name: "soldAt",
      title: "Homes switched to sold",
      type: "datetime",
      readOnly: true,
      hidden: ({ document }) => !document?.soldAt,
    }),
    defineField({
      name: "nextSteps",
      title: "Next steps written for this buyer",
      description: "Optional. When there are steps here, the buyer's dashboard shows them instead of the standard next steps.",
      type: "array",
      of: [defineArrayMember(nextStep)],
      hidden: ({ document }) => document?.role === "admin" || document?.role === "site",
    }),
    defineField({
      name: "planOptions",
      title: "Plans the buyer is choosing between",
      description: "Optional. When there are plans here, the buyer's portal shows them at /account/plans: each as a 3D model with its sizes, list price, the buyer's price and the deposit.",
      type: "object",
      hidden: ({ document }) => document?.role === "admin" || document?.role === "site",
      fields: [
        defineField({ name: "eyebrow", title: "Small heading", type: "string" }),
        defineField({ name: "title", title: "Heading", type: "string" }),
        defineField({ name: "intro", title: "Introduction", type: "text", rows: 3 }),
        defineField({ name: "depositPerHomeUSD", title: "Deposit for each home (US$)", type: "number" }),
        defineField({ name: "depositHomes", title: "Number of homes", type: "number" }),
        defineField({
          name: "only",
          title: "Show the buyer only the plans",
          description: "When on, the buyer's login opens the plans and nothing else: no overview, payments, documents or receipts. Nothing is removed from the account. Turn it off to give the whole portal back.",
          type: "boolean",
        }),
        defineField({
          name: "options",
          title: "Plans",
          type: "array",
          of: [
            defineArrayMember({
              type: "object",
              name: "planOption",
              fields: [
                defineField({ name: "title", title: "Name", type: "string", validation: (rule) => rule.required() }),
                defineField({ name: "model", title: "3D model", description: "The model's id on the website, e.g. u4g1.", type: "string", validation: (rule) => rule.required() }),
                defineField({
                  name: "homes",
                  title: "Homes and sizes",
                  type: "array",
                  of: [
                    defineArrayMember({
                      type: "object",
                      name: "planHome",
                      fields: [
                        defineField({ name: "name", title: "Home", type: "string" }),
                        defineField({ name: "areaSqm", title: "Net internal area (m²)", type: "number" }),
                      ],
                      preview: { select: { title: "name", subtitle: "areaSqm" } },
                    }),
                  ],
                }),
                defineField({ name: "listPriceUSD", title: "List price (US$)", type: "number" }),
                defineField({ name: "priceUSD", title: "The buyer's price (US$)", type: "number", validation: (rule) => rule.required() }),
              ],
              preview: { select: { title: "title", subtitle: "priceUSD" } },
            }),
          ],
        }),
        defineField({
          name: "picks",
          title: "Homes to pick from",
          description: "Optional. When there are homes here, the plans page lets the buyer open each one in 3D, tick the ones they want and see the price add up (the plans above are then not shown).",
          type: "array",
          of: [
            defineArrayMember({
              type: "object",
              name: "planPick",
              fields: [
                defineField({ name: "title", title: "Name", type: "string", validation: (rule) => rule.required() }),
                defineField({ name: "unitNumber", title: "Unit number on the website", description: "Optional, e.g. 204B. It goes into your alert when the buyer confirms.", type: "string" }),
                defineField({ name: "floorLabel", title: "Floor (as shown)", description: "e.g. 4th floor", type: "string" }),
                defineField({ name: "group", title: "List", type: "string", options: { list: [{ title: "Main home", value: "home" }, { title: "Studio", value: "studio" }], layout: "radio" } }),
                defineField({ name: "model", title: "3D model", description: "The model's id on the website, e.g. u4t.", type: "string", validation: (rule) => rule.required() }),
                defineField({ name: "insideSqm", title: "Inside (m²)", type: "number", validation: (rule) => rule.required() }),
                defineField({ name: "balconySqm", title: "Balcony (m²)", type: "number" }),
                defineField({ name: "listPriceUSD", title: "List price (US$)", type: "number" }),
                defineField({ name: "priceUSD", title: "The buyer's price (US$)", type: "number", validation: (rule) => rule.required() }),
                defineField({ name: "preselected", title: "Ticked when the page opens", type: "boolean" }),
              ],
              preview: { select: { title: "title", subtitle: "floorLabel" } },
            }),
          ],
        }),
        defineField({
          name: "front",
          title: "Show the homes to pick from on the buyer's first page",
          description: "When on, the buyer sees the homes to pick from as soon as they sign in, at the top of their first page. The rest of their portal stays.",
          type: "boolean",
        }),
        defineField({
          name: "confirm",
          title: "Let the buyer confirm a selection",
          description: "When on, the homes to pick from have a \"Confirm my selection\" button. Pressing it saves the selection below and sends you an alert. Nothing else changes: the website, the account and the agreement stay yours to update.",
          type: "boolean",
        }),
        defineField({
          name: "pickCount",
          title: "How many homes the buyer chooses",
          description: "Optional. The button then needs exactly this many homes ticked.",
          type: "number",
          validation: (rule) => rule.integer().min(1),
        }),
        defineField({
          name: "chosen",
          title: "The selection the buyer sent",
          type: "object",
          readOnly: true,
          fields: [
            defineField({ name: "at", title: "Sent", type: "datetime" }),
            defineField({ name: "totalUSD", title: "Total at the buyer's prices (US$)", type: "number" }),
            defineField({
              name: "homes",
              title: "Homes",
              type: "array",
              of: [
                defineArrayMember({
                  type: "object",
                  name: "chosenHome",
                  fields: [
                    defineField({ name: "title", title: "Name", type: "string" }),
                    defineField({ name: "floorLabel", title: "Floor", type: "string" }),
                    defineField({ name: "unitNumber", title: "Unit number", type: "string" }),
                    defineField({ name: "listPriceUSD", title: "List price (US$)", type: "number" }),
                    defineField({ name: "priceUSD", title: "The buyer's price (US$)", type: "number" }),
                  ],
                  preview: { select: { title: "title", subtitle: "floorLabel" } },
                }),
              ],
            }),
            defineField({ name: "keys", title: "Keys of the homes", type: "array", of: [{ type: "string" }] }),
          ],
        }),
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
