import { defineArrayMember, defineField, defineType } from "sanity";

// One site update posted from Niko's phone with the progress reporter (/admin/progress):
// the words and the photos shown at the top of the Construction Progress page. The same
// photos are also added to the progress gallery below it, one "Construction update" each.
// To take an update down, delete it here and its photos under "Construction updates".
export const progressReport = defineType({
  name: "progressReport",
  title: "Site update",
  type: "document",
  fields: [
    defineField({ name: "date", title: "Date", type: "date", validation: (Rule) => Rule.required() }),
    defineField({ name: "title", title: "Title", type: "string", validation: (Rule) => Rule.required() }),
    defineField({ name: "text", title: "Text", type: "text", rows: 3 }),
    defineField({ name: "stage", title: "Construction stage", type: "string" }),
    defineField({
      name: "photos",
      title: "Photos",
      type: "array",
      of: [
        defineArrayMember({
          name: "reportPhoto",
          type: "object",
          fields: [
            defineField({ name: "image", title: "Image", type: "image", options: { hotspot: true } }),
            defineField({ name: "alt", title: "Alt text / caption", type: "string" }),
          ],
          preview: { select: { title: "alt", media: "image" } },
        }),
      ],
    }),
    defineField({ name: "facebookUrl", title: "Facebook post", type: "url", readOnly: true }),
    defineField({ name: "instagramUrl", title: "Instagram post", type: "url", readOnly: true }),
  ],
  orderings: [{ title: "Newest first", name: "dateDesc", by: [{ field: "date", direction: "desc" }] }],
  preview: {
    select: { title: "title", date: "date", media: "photos.0.image" },
    prepare({ title, date, media }) {
      return { title, subtitle: date, media };
    },
  },
});
