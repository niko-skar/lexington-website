import { defineQuery } from "next-sanity";

export const buyerAccountByEmailQuery = defineQuery(`
  *[_type == "buyerAccount" && lower(email) == $email][0]{
    ...,
    signedAgreements[]{
      label,
      "fileUrl": file.asset->url
    }
  }
`);

export const buyerAccountsQuery = defineQuery(`
  *[_type == "buyerAccount"] | order(email asc) {
    _id,
    email,
    name,
    role,
    unitNumber
  }
`);

export const buyerAccountByIdQuery = defineQuery(`
  *[_type == "buyerAccount" && _id == $id][0]
`);

export const standardAgreementsQuery = defineQuery(`
  *[_type == "standardAgreements"][0]{
    documents[]{
      label,
      "fileUrl": file.asset->url
    }
  }
`);
