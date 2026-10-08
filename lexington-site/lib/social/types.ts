// The daily social posts. calendar.json is produced by the separate "lexington-social" project (pictures in
// public/social, captions, and the live checks each post carries) and copied in here.

export interface SocialCheck {
  note: string;
  /** a GROQ query against the published Sanity dataset ... */
  q?: string;
  /** ... or a path on the live website whose text must contain `includes` */
  page?: string;
  equals?: unknown;
  includes?: string;
  includesAll?: string[];
}

export interface SocialPost {
  id: string;
  /** the day it goes out (UTC date, YYYY-MM-DD) */
  date: string;
  pillar: string;
  title: string;
  /** picture file names inside public/social, in swipe order */
  images: string[];
  /** screen-reader text, one per picture */
  alt: string[];
  fb: string;
  ig: string;
  checks: SocialCheck[];
  notes: string;
}

export interface SocialCalendar {
  generated: string;
  postHourUtc: number;
  posts: SocialPost[];
}

export type Platform = "fb" | "ig";

export interface PlatformResult {
  ok: boolean;
  id?: string;
  url?: string;
  at?: string;
  error?: string;
  attempts?: number;
}

/** What happened on one day, kept in the private dataset so a retry never double-posts. */
export interface SocialLog {
  _id: string;
  _type: "socialLog";
  date: string;
  post: string;
  status: "posted" | "partial" | "held" | "failed";
  fb?: PlatformResult;
  ig?: PlatformResult;
  heldReasons?: string[];
  noticeSent?: boolean;
}
