import { defineQuery } from "next-sanity";

// What the buyer portal reads of an account. One shape, whoever asks for it: the buyer's own sign-in (by email or
// username) or an admin looking at the portal as the buyer sees it (by id; lib/auth/portalView.ts).
const PORTAL_ACCOUNT = `{
    ...,
    signedAgreements[]{
      label,
      "fileUrl": file.asset->url
    },
    "contractDraft": contractDraft{
      label,
      paymentStep,
      detailsAddedAt,
      "fileUrl": current.asset->url,
      "fillBaseUrl": fillBase.asset->url
    }
  }`;

export const buyerAccountByEmailQuery = defineQuery(`
  *[_type == "buyerAccount" && lower(email) == $email][0]${PORTAL_ACCOUNT}
`);

export const buyerPortalAccountByIdQuery = defineQuery(`
  *[_type == "buyerAccount" && _id == $id][0]${PORTAL_ACCOUNT}
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
