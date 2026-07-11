import { defineArrayMember, defineField, defineType } from "sanity";

// key is fixed (not editable) — it's how unit.minPackageTier and the
// frontend's pricing logic identify a tier, so it must stay stable even
// if the display name changes.
const packageTier = {
  name: "packageTier",
  title: "Package tier",
  type: "object",
  fields: [
    defineField({
      name: "key",
      title: "Key",
      type: "string",
      options: {
        list: [
          { title: "Standard", value: "standard" },
          { title: "Premium", value: "premium" },
          { title: "Premium Plus", value: "premiumplus" },
        ],
      },
      validation: (Rule) => Rule.required(),
    }),
    defineField({ name: "name", title: "Display name", type: "string", validation: (Rule) => Rule.required() }),
    defineField({
      name: "ratePerSqm",
      title: "Rate (USD per sqm)",
      description: "Added on top of a unit's listed price, multiplied by its area — e.g. 150 means +$150 per sqm.",
      type: "number",
      validation: (Rule) => Rule.required().min(0),
    }),
    defineField({
      name: "badge",
      title: "Badge",
      description: 'Small label shown on the card, e.g. "Smart Home". Leave empty for none.',
      type: "string",
    }),
    defineField({ name: "description", title: "Short description", type: "string" }),
    defineField({
      name: "features",
      title: "Features",
      type: "array",
      of: [defineArrayMember({ type: "string" })],
    }),
    defineField({
      name: "note",
      title: "Note",
      description:
        'Optional small print under the card, e.g. "Not offered on 3BR Duplex Penthouses — Premium is included as standard."',
      type: "string",
    }),
  ],
  preview: {
    select: { title: "name", subtitle: "ratePerSqm" },
    prepare({ title, subtitle }: { title?: string; subtitle?: number }) {
      return { title, subtitle: subtitle ? `+$${subtitle}/sqm` : "Included" };
    },
  },
};

// Singleton: fixed _id "packageTiers", no create/duplicate/delete (pinned
// in structure.ts the same way financingPlan is).
export const packageTiers = defineType({
  name: "packageTiers",
  title: "Apartment packages",
  type: "document",
  fields: [
    defineField({
      name: "tiers",
      title: "Tiers",
      description: "Keep these in Standard → Premium → Premium Plus order.",
      type: "array",
      of: [defineArrayMember(packageTier)],
      validation: (Rule) => Rule.length(3),
    }),
  ],
  preview: {
    prepare() {
      return { title: "Apartment packages" };
    },
  },
});
