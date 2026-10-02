export interface LeadTask {
  _key: string;
  text: string;
  /** "YYYY-MM-DD". Missing means "today" wherever it matters. */
  due?: string;
  /** Who has to act next. Missing means "me". */
  waitingOn?: "me" | "them";
  done?: boolean;
  createdAt?: string;
  doneAt?: string;
}

export interface LeadNote {
  _key: string;
  at: string;
  kind: "note" | "stage" | "system";
  text: string;
}

export interface Lead {
  _id: string;
  _createdAt: string;
  _updatedAt: string;
  name: string;
  phone?: string;
  email?: string;
  source?: string;
  stage: string;
  lostReason?: string;
  /** What they asked about, e.g. the website form's "Interested in" answer. */
  interest?: string;
  unitNumber?: string;
  paymentPreference?: string;
  agreedPriceUSD?: number;
  /** Set once a buyer login has been created from this prospect. */
  buyerAccountId?: string;
  tasks?: LeadTask[];
  notes?: LeadNote[];
}

export interface UnitOption {
  unitNumber: string;
  bedroomType: string;
  floor: number;
  areaSqm: number;
  priceUSD: number;
  status: string;
}
