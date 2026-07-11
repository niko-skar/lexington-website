import type { StructureResolver } from "sanity/structure";

// financingPlan is a singleton: fixed _id "financingPlan", no create/duplicate/delete.
export const structure: StructureResolver = (S) =>
  S.list()
    .title("Content")
    .items([
      S.listItem()
        .title("Units")
        .child(
          S.documentTypeList("unit")
            .title("Units")
            .defaultOrdering([
              { field: "floor", direction: "asc" },
              { field: "unitNumber", direction: "asc" },
            ])
        ),
      S.listItem()
        .title("Gallery images")
        .child(S.documentTypeList("galleryImage").title("Gallery images")),
      S.listItem()
        .title("Amenities")
        .child(S.documentTypeList("amenity").title("Amenities")),
      S.listItem()
        .title("Family members")
        .child(S.documentTypeList("familyMember").title("Family members")),
      S.divider(),
      S.listItem()
        .title("Apartment packages")
        .id("packageTiers")
        .child(
          S.document().schemaType("packageTiers").documentId("packageTiers")
        ),
      S.listItem()
        .title("Financing plan")
        .id("financingPlan")
        .child(
          S.document().schemaType("financingPlan").documentId("financingPlan")
        ),
      S.listItem()
        .title("Site settings")
        .id("siteSettings")
        .child(
          S.document().schemaType("siteSettings").documentId("siteSettings")
        ),
    ]);
