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

/** The lead responder's suggested reply, kept on the prospect until it is sent or put aside. */
export interface ReplyDraft {
  createdAt: string;
  /** "claude" when Claude wrote it, "template" for the plain fill-in-the-blanks reply. */
  writer: "claude" | "template";
  subject: string;
  body: string;
  whatsapp: string;
  temperature?: "hot" | "warm" | "cold";
  temperatureReason?: string;
  /** What the fact check found, and what only Niko can answer: "check before sending". */
  warnings: string[];
  /** The units it suggests. */
  units: string[];
  status: "draft" | "sent" | "discarded";
  sentAt?: string;
  sentVia?: "email" | "whatsapp" | "auto-email";
  /** Why Claude did not write it, when it didn't. */
  note?: string;
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
  /** In lists only: the last thing typed about them, or how they first came in. */
  context?: string;
  /** Set by the website form and the Facebook lead forms: the lead responder should suggest a first reply. */
  replyWanted?: boolean;
  replyDraft?: ReplyDraft;
  /** The Facebook / Instagram lead form entry this prospect came from (so it is never added twice). */
  metaLeadId?: string;
  /** Their lead form answers, as asked. */
  formAnswers?: Array<{ _key: string; question: string; answer: string }>;
}

export interface UnitOption {
  unitNumber: string;
  bedroomType: string;
  floor: number;
  areaSqm: number;
  priceUSD: number;
  status: string;
}
