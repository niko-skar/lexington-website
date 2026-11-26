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
  /** Who wrote it, when it wasn't the office (a login of the app with Customers, 19 Nov 2026). */
  by?: string;
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
  /** Messenger / Instagram: answered in their chat, by the assistant or by Niko (lib/crmReplies.ts). */
  sentVia?: "email" | "whatsapp" | "auto-email" | "messenger" | "instagram";
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
  /** The campaign and ad set that entry came from (the ads autopilot counts real leads per budget). */
  metaCampaignId?: string;
  metaAdsetId?: string;
  metaAdId?: string;
  /** Their lead form answers, as asked. */
  formAnswers?: Array<{ _key: string; question: string; answer: string }>;
  /** Meta's word on where they filled in the lead form: "fb" (Facebook) or "ig" (Instagram). */
  metaPlatform?: string;
  /** Meta's link to their Messenger chat, when the lead form opened one. */
  metaInboxUrl?: string;
  /** The advert's tag when they came to the website from one (utm_source: "ig", "facebook"...). */
  adSource?: string;
  /** Their chat with the assistant (a chatThread id). */
  chatThread?: string;
  /** The first WhatsApp from The Lexington's number after their lead form (lib/agents/whatsapp.ts, 26 Nov 2026). */
  whatsappFirst?: { status?: string; at?: string; attempts?: number; mid?: string; to?: string; error?: string };
  /** In lists only: that chat's channel. */
  chatChannel?: string;
  /** The login (a buyerAccount id) whose list they're on, e.g. Rahma's (20 Nov 2026); none = the office's list. */
  assignedTo?: string;
}

/** A login of the app with Customers: the office can give it prospects (components/crm/Team.tsx). */
export interface CrmTeamMember {
  id: string;
  name: string;
}

export interface UnitOption {
  unitNumber: string;
  bedroomType: string;
  floor: number;
  areaSqm: number;
  priceUSD: number;
  status: string;
}
