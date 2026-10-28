import { defineField, defineType } from "sanity";

const pageIntroFields = [
  defineField({ name: "eyebrow", title: "Eyebrow", type: "string" }),
  defineField({ name: "title", title: "Title", type: "string" }),
  defineField({ name: "lede", title: "Lede", type: "text", rows: 2 }),
];

export const siteSettings = defineType({
  name: "siteSettings",
  title: "Site Settings",
  type: "document",
  groups: [
    { name: "banner", title: "Current Offer" },
    { name: "vat", title: "VAT" },
    { name: "contact", title: "Contact Info" },
    { name: "home", title: "Home Page" },
    { name: "pages", title: "Page Intros" },
  ],
  fields: [
    defineField({
      name: "promoBanner",
      title: "Current offer",
      description:
        "The offer shown at the top of the Invest page. The lead replies, ads and daily posts also read it, so keep this shape: \"Phase 1 pricing ends 30th of November — 15% off with full payment or 8% off with flexible payment plans up to 18 months.\" The last day and the percentages are taken from these words. Switch it off and the page, the replies and the ads stop mentioning an offer.",
      type: "object",
      group: "banner",
      fields: [
        defineField({ name: "enabled", title: "Offer is running", type: "boolean", initialValue: true }),
        defineField({ name: "message", title: "Offer wording", type: "string" }),
      ],
    }),

    defineField({
      name: "vat",
      title: "VAT on prices",
      description:
        "Switch on once The Lexington is VAT-registered. Every price on the website, the unit pictures sent in chats, the AI replies and the ads then say \"+ VAT\", and each unit's pop-up shows the VAT and the total. Leave it off until then.",
      type: "object",
      group: "vat",
      fields: [
        defineField({ name: "on", title: "Add VAT to prices", type: "boolean", initialValue: false }),
        defineField({
          name: "rate",
          title: "VAT rate (%)",
          description: "20 = VAT 15% + NHIL 2.5% + GETFund 2.5% (confirmed by the accountant, 28 Oct 2026).",
          type: "number",
          initialValue: 20,
          validation: (Rule) => Rule.min(1).max(50),
        }),
      ],
    }),

    defineField({ name: "contactPhone", title: "Phone", type: "string", group: "contact" }),
    defineField({ name: "contactEmail", title: "Email", type: "string", group: "contact" }),
    defineField({
      name: "notificationEmail",
      title: "Enquiry notification email",
      description:
        "Where contact-form submissions are actually delivered — can differ from the public Email above (e.g. while Resend's sending domain isn't verified yet, it must be an address you've confirmed with Resend).",
      type: "string",
      group: "contact",
    }),
    defineField({ name: "officeAddress", title: "Office address", type: "string", group: "contact" }),
    defineField({ name: "disclaimer", title: "Disclaimer", type: "text", rows: 2, group: "contact" }),

    defineField({ name: "heroEyebrow", title: "Hero eyebrow", type: "string", group: "home" }),
    defineField({ name: "heroTitle", title: "Hero title", type: "string", group: "home" }),
    defineField({ name: "heroLede", title: "Hero lede", type: "text", rows: 2, group: "home" }),

    defineField({ name: "residencesIntro", title: "Residences intro", type: "object", fields: pageIntroFields, group: "pages" }),
    defineField({ name: "amenitiesIntro", title: "Amenities intro", type: "object", fields: pageIntroFields, group: "pages" }),
    defineField({ name: "galleryIntro", title: "Gallery intro", type: "object", fields: pageIntroFields, group: "pages" }),
    defineField({ name: "progressIntro", title: "Progress intro", type: "object", fields: pageIntroFields, group: "pages" }),
    defineField({ name: "investIntro", title: "Invest intro", type: "object", fields: pageIntroFields, group: "pages" }),
    defineField({ name: "aboutIntro", title: "About intro", type: "object", fields: pageIntroFields, group: "pages" }),
    defineField({ name: "contactIntro", title: "Contact intro", type: "object", fields: pageIntroFields, group: "pages" }),
  ],
  preview: {
    prepare() {
      return { title: "Site Settings" };
    },
  },
});
