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
    defineField({
      name: "image",
      title: "Photo",
      type: "image",
      options: { hotspot: true },
      description:
        "Optional — if left empty, the site falls back to guessing a photo from the Gallery by matching this amenity's name.",
    }),
    defineField({
      name: "caption",
      title: "Caption",
      type: "string",
      description: "Short description shown when hovering over this amenity's photo.",
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
    select: { title: "name", subtitle: "category", media: "image" },
  },
});
