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
    defineField({
      name: "upfrontPayment",
      title: "Upfront payment",
      type: "string",
    }),
    defineField({ name: "discount", title: "Discount", type: "string" }),
  ],
  preview: {
    select: { title: "milestone", subtitle: "timeframe" },
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
  ],
  preview: {
    prepare() {
      return { title: "Financing plan" };
    },
  },
});
