// Alerts for Niko in the site app. Niko, 23 Oct 2026: "stop all emails to me for notifications,
// and instead build in notifications onto the site to do app". What the website used to email him
// (enquiries, reservations, Facebook leads, chats handed over, the daily ads check, the daily posts,
// receipt copies) is now a line in the app's Alerts tab; the ones he has to act on also buzz his
// phone. Only the office sees them: a site login (the foreman) never does. Since 27 Oct 2026 a job
// the foreman adds to the to-do list is one too; the foreman gets no Alerts tab, only a buzz on his
// own phone when the office adds a site job (lib/todo/server.ts).

export const ALERT_KINDS = ["enquiry", "reservation", "lead", "chat", "ads", "post", "receipt", "books", "todo", "test"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export const KIND_LABEL: Record<AlertKind, string> = {
  enquiry: "Website enquiry",
  reservation: "Reservation",
  lead: "Facebook lead",
  chat: "Message",
  ads: "Ads check",
  post: "Daily post",
  receipt: "Receipt",
  books: "QuickBooks",
  todo: "Site to-do",
  test: "Test",
};

export interface AlertLink {
  label: string;
  /** A page of the site ("/admin/crm/...") or another site (Business Suite, a post). */
  url: string;
}

export interface OwnerAlert {
  id: string;
  kind: AlertKind;
  title: string;
  lines: string[];
  links: AlertLink[];
  /** It buzzed the phone (the ones that need him). */
  urgent: boolean;
  createdAt: string;
  readAt: string | null;
}

export interface PushDevice {
  id: string;
  name: string;
  since: string;
}

export interface PushState {
  /** The website can send phone alerts (its keys are set). */
  configured: boolean;
  publicKey: string | null;
  /** The phones that get the signed-in person's alerts (the office's, or one site login's). */
  devices: PushDevice[];
}

export interface AlertsData {
  alerts: OwnerAlert[];
  unread: number;
}

export const MAX_TITLE = 160;
export const MAX_LINE = 600;
export const MAX_LINES = 24;
export const MAX_LINKS = 6;
