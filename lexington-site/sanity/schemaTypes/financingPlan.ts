import { defineArrayMember, defineField, defineType } from "sanity";

const selfFinanceRow = {
  name: "selfFinanceRow",
  title: "Self-finance row",
  type: "object",
  fields: [
    defineField({ name: "milestone", title: "Milestone", type: "string" }),
    defineField({ name: "timeframe", title: "Timeframe", type: "string" }),
    defineField({ name: "option1", title: "Option 1", type: "string" }),
    defineField({ name: "option2", title: "Option 2", type: "string" }),
  ],
  preview: {
    select: { title: "milestone", subtitle: "timeframe" },
  },
};

const upfrontDiscountTier = {
  name: "upfrontDiscountTier",
  title: "Upfront discount tier",
  type: "object",
  fields: [
    defineField({
      name: "upfrontPayment",
      title: "Upfront cash payment",
      description: 'Percentage of the total price paid upfront in cash, e.g. "100%"',
      type: "string",
    }),
    defineField({ name: "discount", title: "Discount", type: "string" }),
  ],
  preview: {
    select: { title: "upfrontPayment", subtitle: "discount" },
  },
};

const mortgageRow = {
  name: "mortgageRow",
  title: "Mortgage row",
  type: "object",
  fields: [
    defineField({ name: "milestone", title: "Milestone", type: "string" }),
    defineField({ name: "timeframe", title: "Timeframe", type: "string" }),
    defineField({ name: "option1", title: "Option 1", type: "string" }),
  ],
  preview: {
    select: { title: "milestone", subtitle: "timeframe" },
  },
};

export const financingPlan = defineType({
  name: "financingPlan",
  title: "Financing plan",
  type: "document",
  fields: [
    defineField({
      name: "selfFinanceRows",
      title: "Self-finance plan",
      type: "array",
      of: [defineArrayMember(selfFinanceRow)],
    }),
    defineField({
      name: "upfrontDiscountTiers",
      title: "Upfront cash payment discounts",
      description:
        "Applies only to buyers paying a percentage of the total price upfront in cash — not tied to the self-finance installment schedule.",
      type: "array",
      of: [defineArrayMember(upfrontDiscountTier)],
    }),
    defineField({
      name: "mortgageRows",
      title: "Mortgage plan",
      type: "array",
      of: [defineArrayMember(mortgageRow)],
    }),
    defineField({
      name: "buyToRent",
      title: "Buy to rent",
      type: "object",
      fields: [
        defineField({
          name: "oneBedroomRange",
          title: "One bedroom rental range",
          type: "string",
        }),
        defineField({
          name: "twoBedroomRange",
          title: "Two bedroom rental range",
          type: "string",
        }),
        defineField({
          name: "projectedYieldPct",
          title: "Projected yield (%)",
          type: "number",
        }),
      ],
    }),
    defineField({
      name: "serviceCharge",
      title: "Building management fee",
      description: "The Invest page's \"Ongoing Costs\" section, shown before Buy to Rent.",
      type: "object",
      fields: [
        defineField({ name: "description", title: "Description", type: "text" }),
        defineField({
          name: "coveredItems",
          title: "What it covers",
          type: "array",
          of: [defineArrayMember({ type: "string" })],
        }),
        defineField({ name: "note", title: "Note", type: "text" }),
      ],
    }),
  ],
  preview: {
    prepare() {
      return { title: "Financing plan" };
    },
  },
});
