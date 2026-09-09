export type PaymentCurrency = "GHS" | "USD";
export type PaymentMethod = "cash" | "momo" | "bank-transfer";

export interface Payment {
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
  unitNumber: string;
  contractPriceUSD: number;
  payments?: Payment[];
  signedAgreements?: SignedAgreement[];
}

export interface BuyerAccountSummary {
  _id: string;
  email: string;
  name: string;
  unitNumber: string;
}

export interface StandardAgreementDoc {
  label: string;
  fileUrl: string;
}

export interface StandardAgreements {
  documents?: StandardAgreementDoc[];
}
