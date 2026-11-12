export type PaymentCurrency = "GHS" | "USD";
export type PaymentMethod = "cash" | "momo" | "bank-transfer";

export interface Payment {
  /** Sanity's id for this row of the payments list; what a receipt is tied to. */
  _key?: string;
  amount: number;
  currency?: PaymentCurrency;
  /** GHS per USD on the day of payment. Only meaningful when currency is GHS. */
  exchangeRate?: number;
  date?: string;
  method?: PaymentMethod;
  note?: string;
}

export interface SignedAgreement {
  label: string;
  fileUrl: string;
}

export interface BuyerAccount {
  _id: string;
  email: string;
  passwordHash: string;
  name: string;
  /** Absent means an ordinary buyer. "admin" accounts sign in at /login but land in /admin;
   *  "site" accounts (the foreman) land on the site to-do list at /todo and can open nothing else. */
  role?: "buyer" | "admin" | "site";
  /** Admin accounts have no unit or contract price. Two homes on one account: "Studio 1, 204B". */
  unitNumber: string;
  contractPriceUSD: number;
  /** The price before this buyer's discount; the dashboard shows the saving when it is above the contract price. */
  listPriceUSD?: number;
  payments?: Payment[];
  signedAgreements?: SignedAgreement[];
  contractDraft?: ContractDraft;
  buyerDetails?: BuyerDetails;
  /** Steps written for this buyer: when there are any, the dashboard shows them instead of the standard ones. */
  nextSteps?: NextStep[];
  /** Plans the buyer is choosing between, each a 3D model with its price: shown at /account/plans. */
  planOptions?: PlanOptionSet;
}

/** The plans a buyer is choosing between (a home drawn more than one way), with the deposit. */
export interface PlanOptionSet {
  eyebrow?: string;
  title?: string;
  intro?: string;
  depositPerHomeUSD?: number;
  depositHomes?: number;
  /** The buyer sees the plans and nothing else in the portal (lib/planOptions.ts: seesOnlyPlans). */
  only?: boolean;
  options?: PlanOption[];
}

export interface PlanOption {
  _key?: string;
  title: string;
  /** The 3D model's id (app/account/plans/page.tsx lists the ones the site has). */
  model: string;
  homes?: { _key?: string; name: string; areaSqm: number }[];
  /** The price before this buyer's discount. */
  listPriceUSD?: number;
  /** The buyer's price for this plan. */
  priceUSD: number;
}

export interface NextStep {
  _key?: string;
  title: string;
  text?: string;
  /** Ticks itself once the buyer's payments come to this many US dollars (e.g. a deposit). */
  donePaidUSD?: number;
  done?: boolean;
  /** A button under the step: the draft agreement, or the details form. */
  link?: "draft" | "details";
}

/** The draft agreement on the buyer's dashboard, with the next steps (only the account query projects the urls). */
export interface ContractDraft {
  label?: string;
  fileUrl?: string;
  /** The same draft with markers where the buyer's own details go (lib/contracts/fill.ts). */
  fillBaseUrl?: string;
  paymentStep?: string;
  detailsAddedAt?: string;
}

/** What the buyer sent from the portal for their agreement. */
export interface BuyerDetails {
  citizenOfGhana?: boolean;
  otherCitizenship?: string;
  idType?: "ghana-card" | "passport";
  idNumber?: string;
  idCountry?: string;
  address?: string;
  emergencyName?: string;
  emergencyRelationship?: string;
  emergencyAddress?: string;
  emergencyEmail?: string;
  emergencyPhone?: string;
  comments?: string;
  submittedAt?: string;
}

export interface BuyerAccountSummary {
  _id: string;
  email: string;
  name: string;
  role?: "buyer" | "admin" | "site";
  unitNumber?: string;
}

export interface StandardAgreementDoc {
  label: string;
  fileUrl: string;
}

export interface StandardAgreements {
  documents?: StandardAgreementDoc[];
}
