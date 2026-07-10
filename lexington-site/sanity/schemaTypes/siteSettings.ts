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
    { name: "contact", title: "Contact Info" },
    { name: "home", title: "Home Page" },
    { name: "pages", title: "Page Intros" },
  ],
  fields: [
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
