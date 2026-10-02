import type { StructureResolver } from "sanity/structure";

// standardAgreements is a singleton: fixed _id "standardAgreements", no
// create/duplicate/delete -- same convention as financingPlan in the
// public workspace (see sanity/structure.ts).
export const buyersStructure: StructureResolver = (S) =>
  S.list()
    .title("Buyers")
    .items([
      S.listItem()
        .title("Buyer accounts")
        .child(
          S.documentTypeList("buyerAccount")
            .title("Buyer accounts")
            .defaultOrdering([{ field: "email", direction: "asc" }])
        ),
      S.listItem()
        .title("Prospects (CRM backup view)")
        .child(
          S.documentTypeList("lead")
            .title("Prospects")
            .defaultOrdering([{ field: "_createdAt", direction: "desc" }])
        ),
      S.listItem()
        .title("Receipts issued")
        .child(
          S.documentTypeList("receipt")
            .title("Receipts issued")
            .defaultOrdering([{ field: "number", direction: "desc" }])
        ),
      S.divider(),
      S.listItem()
        .title("Standard agreements")
        .id("standardAgreements")
        .child(
          S.document()
            .schemaType("standardAgreements")
            .documentId("standardAgreements")
        ),
    ]);
