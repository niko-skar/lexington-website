import { defineField, defineType } from "sanity";

// Building-location diagrams: a floor plan with specific units highlighted,
// showing where a unit sits within the building. Each floor's units are
// split across one or two of these images (the brochure renders don't
// always fit every unit on a floor into a single diagram), so a unit is
// matched by checking which document's `units` list includes its number.
export const unitLocationPlan = defineType({
  name: "unitLocationPlan",
  title: "Unit location plan",
  type: "document",
  fields: [
    defineField({
      name: "floor",
      title: "Floor",
      type: "number",
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "units",
      title: "Unit numbers shown",
      type: "array",
      of: [{ type: "string" }],
      validation: (Rule) => Rule.required().min(1),
    }),
    defineField({
      name: "image",
      title: "Image",
      type: "image",
      options: { hotspot: true },
      validation: (Rule) => Rule.required(),
    }),
  ],
  preview: {
    select: { units: "units", floor: "floor", media: "image" },
    prepare({ units, floor, media }) {
      return {
        title: Array.isArray(units) ? units.join(", ") : "Unit location plan",
        subtitle: `Floor ${floor}`,
        media,
      };
    },
  },
});
