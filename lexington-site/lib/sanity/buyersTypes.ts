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
  /** Admin accounts have no unit or contract price. */
  unitNumber: string;
  contractPriceUSD: number;
  /** The price before this buyer's discount; the dashboard shows the saving when it is above the contract price. */
  listPriceUSD?: number;
  payments?: Payment[];
  signedAgreements?: SignedAgreement[];
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
