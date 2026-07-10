import { defineField, defineType } from "sanity";

// Stage is a free-text field rather than a fixed list — construction
// hasn't reached upper floors yet, and new stage names (First Floor,
// Roofing, Facade, Handover...) will need to be added in Studio as the
// build progresses, without a code change. The frontend derives its
// filter chips from whatever stage values actually exist in the data.
export const constructionUpdate = defineType({
  name: "constructionUpdate",
  title: "Construction update",
  type: "document",
  fields: [
    defineField({
      name: "image",
      title: "Image",
      type: "image",
      options: { hotspot: true },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "alt",
      title: "Alt text / caption",
      type: "string",
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "stage",
      title: "Construction stage",
      type: "string",
      description:
        'E.g. "Groundbreaking", "Earthworks", "Foundations", "Ground Floor", "First Floor" — free text so new stages can be added later without a code change.',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "order",
      title: "Order",
      type: "number",
      description: "Controls both the photo sequence and the left-to-right order of stage filter chips.",
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
    select: { title: "alt", stage: "stage", media: "image" },
    prepare({ title, stage, media }) {
      return { title, subtitle: stage, media };
    },
  },
});
