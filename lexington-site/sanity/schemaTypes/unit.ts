import { defineField, defineType } from "sanity";

export const unit = defineType({
  name: "unit",
  title: "Unit",
  type: "document",
  fields: [
    defineField({
      name: "unitNumber",
      title: "Unit number",
      type: "string",
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "floor",
      title: "Floor",
      type: "number",
      description:
        "Use 0 for the ground floor, 7 for the duplex penthouse tier (shown as its own group in the Unit Finder).",
      validation: (Rule) => Rule.required().integer().min(0),
    }),
    defineField({
      name: "bedroomType",
      title: "Bedroom type",
      type: "string",
      options: {
        list: [
          { title: "Studio", value: "Studio" },
          { title: "One Bedroom", value: "One Bedroom" },
          { title: "Two Bedroom", value: "Two Bedroom" },
          { title: "3BR Duplex Penthouse", value: "3BR Duplex Penthouse" },
        ],
      },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "areaSqm",
      title: "Area (sqm)",
      type: "number",
      validation: (Rule) => Rule.required().positive(),
    }),
    defineField({
      name: "priceUSD",
      title: "Price (USD)",
      description: "Price at this unit's minimum package tier (see below) — Standard for most units.",
      type: "number",
      validation: (Rule) => Rule.required().positive(),
    }),
    defineField({
      name: "minPackageTier",
      title: "Minimum package tier",
      description:
        'Leave as Standard for most units. Set to Premium for units (e.g. penthouses) that never drop below that finish — "Price (USD)" above is then read as the Premium price, and Standard won\'t be offered for this unit.',
      type: "string",
      options: {
        list: [
          { title: "Standard", value: "standard" },
          { title: "Premium", value: "premium" },
          { title: "Premium Plus", value: "premiumplus" },
        ],
      },
      initialValue: "standard",
    }),
    defineField({
      name: "status",
      title: "Status",
      type: "string",
      options: {
        list: [
          { title: "Available", value: "available" },
          { title: "Reserved", value: "reserved" },
          { title: "Sold", value: "sold" },
        ],
        layout: "radio",
      },
      initialValue: "available",
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "notes",
      title: "Notes",
      type: "text",
      rows: 3,
    }),
  ],
  orderings: [
    {
      title: "Floor, then unit number",
      name: "floorUnit",
      by: [
        { field: "floor", direction: "asc" },
        { field: "unitNumber", direction: "asc" },
      ],
    },
  ],
  preview: {
    select: {
      title: "unitNumber",
      floor: "floor",
      status: "status",
      price: "priceUSD",
    },
    prepare({ title, floor, status, price }) {
      return {
        title: `${title} — Floor ${floor === 0 ? "Ground" : floor}`,
        subtitle: `${status} · $${price?.toLocaleString()}`,
      };
    },
  },
});
