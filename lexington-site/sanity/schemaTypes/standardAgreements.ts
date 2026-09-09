import { defineArrayMember, defineField, defineType } from "sanity";

export const standardAgreements = defineType({
  name: "standardAgreements",
  title: "Standard Agreements",
  type: "document",
  fields: [
    defineField({
      name: "documents",
      title: "Documents",
      description: "Shown to every logged-in buyer, e.g. reservation agreement, purchase agreement templates.",
      type: "array",
      of: [
        defineArrayMember({
          type: "object",
          name: "standardAgreementDoc",
          fields: [
            defineField({ name: "label", title: "Label", type: "string", validation: (Rule) => Rule.required() }),
            defineField({ name: "file", title: "File", type: "file", validation: (Rule) => Rule.required() }),
          ],
          preview: {
            select: { title: "label" },
          },
        }),
      ],
    }),
  ],
  preview: {
    prepare() {
      return { title: "Standard Agreements" };
    },
  },
});
