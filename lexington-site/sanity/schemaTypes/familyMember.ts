import { defineField, defineType } from "sanity";

export const familyMember = defineType({
  name: "familyMember",
  title: "Family member",
  type: "document",
  fields: [
    // The website shows the family name only — no first names, no family
    // photos (owner, 12 Nov 2026). Name and photo are for Studio; the site
    // reads years and bio, and tells the generations apart by order.
    defineField({
      name: "name",
      title: "Name",
      type: "string",
      description: "Studio only — the website shows the surname alone, never first names.",
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "years",
      title: "Years",
      type: "string",
      description: 'e.g. "1922 – Present"',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "bio",
      title: "Bio",
      type: "text",
      rows: 4,
      description: "Shown on Our Story. Keep first names out of it.",
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "photo",
      title: "Photo",
      type: "image",
      description: "Studio only — family photos are not shown on the website.",
      options: { hotspot: true },
    }),
    defineField({
      name: "order",
      title: "Order",
      type: "number",
      initialValue: 0,
    }),
  ],
  orderings: [
    {
      title: "Display order",
      name: "orderAsc",
      by: [{ field: "order", direction: "asc" }],
    },
  ],
  preview: {
    select: { title: "name", subtitle: "years", media: "photo" },
  },
});
