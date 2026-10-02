import { unit } from "./unit";
import { galleryImage } from "./galleryImage";
import { amenity } from "./amenity";
import { familyMember } from "./familyMember";
import { financingPlan } from "./financingPlan";
import { siteSettings } from "./siteSettings";
import { unitLocationPlan } from "./unitLocationPlan";
import { constructionUpdate } from "./constructionUpdate";
import { packageTiers } from "./packageTiers";
import { buyerAccount } from "./buyerAccount";
import { standardAgreements } from "./standardAgreements";
import { lead } from "./lead";
import { receipt } from "./receipt";

export const schemaTypes = [
  unit,
  galleryImage,
  amenity,
  familyMember,
  financingPlan,
  siteSettings,
  unitLocationPlan,
  constructionUpdate,
  packageTiers,
];

// Buyer accounts, payments and signed documents live in a separate,
// private Sanity dataset (see sanity.config.ts) -- kept out of the
// public schema above so nobody can create a buyer record while
// browsing the public workspace, and so this sensitive data never
// touches the publicly-readable production dataset.
export const buyersSchemaTypes = [buyerAccount, standardAgreements, lead, receipt];
