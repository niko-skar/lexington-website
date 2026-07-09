import { defineField, defineType } from "sanity";

export const amenity = defineType({
  name: "amenity",
  title: "Amenity",
  type: "document",
  fields: [
    defineField({
      name: "name",
      title: "Name",
      type: "string",
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "category",
      title: "Category",
      type: "string",
      description:
        'Only mark "Rooftop" for amenities actually located on the roof (e.g. the Rooftop Garden) — most signature amenities (pool, gym, etc.) don\'t have a confirmed floor location.',
      options: {
        list: [
          { title: "Rooftop", value: "rooftop" },
          { title: "Signature", value: "signature" },
          { title: "Building feature", value: "building feature" },
        ],
      },
      validation: (Rule) => Rule.required(),
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
    select: { title: "name", subtitle: "category" },
  },
});
