import { defineQuery } from "next-sanity";

export const unitsQuery = defineQuery(`
  *[_type == "unit"] | order(floor asc, unitNumber asc) {
    ...,
    floorPlans[]->{_id, image, alt, category, order},
    locationPlan->{_id, floor, units, image}
  }
`);

// Slim unit list for pickers (the CRM's "which unit" dropdown).
export const unitOptionsQuery = defineQuery(`
  *[_type == "unit"] | order(floor asc, unitNumber asc) {
    unitNumber,
    bedroomType,
    floor,
    areaSqm,
    priceUSD,
    status
  }
`);

// Buyer dashboard looks up a single unit by number -- buyerAccount lives in
// a separate dataset and can't hold a real Sanity reference across
// datasets, so this is a plain string match instead.
export const unitByNumberQuery = defineQuery(`
  *[_type == "unit" && unitNumber == $unitNumber][0]
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

export const constructionUpdatesQuery = defineQuery(`
  *[_type == "constructionUpdate"] | order(order asc)
`);

export const packageTiersQuery = defineQuery(`
  *[_type == "packageTiers"][0]
`);
