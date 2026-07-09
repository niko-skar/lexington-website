import { defineQuery } from "next-sanity";

export const unitsQuery = defineQuery(`
  *[_type == "unit"] | order(floor asc, unitNumber asc)
`);

export const galleryImagesQuery = defineQuery(`
  *[_type == "galleryImage"] | order(order asc) {
    _id,
    image,
    alt,
    category,
    order
  }
`);

export const amenitiesQuery = defineQuery(`
  *[_type == "amenity"] | order(order asc)
`);

export const familyMembersQuery = defineQuery(`
  *[_type == "familyMember"] | order(order asc)
`);

export const financingPlanQuery = defineQuery(`
  *[_type == "financingPlan"][0]
`);

export const siteSettingsQuery = defineQuery(`
  *[_type == "siteSettings"][0]
`);
