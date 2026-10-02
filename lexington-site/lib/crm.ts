// Shared CRM definitions. No server-only imports here: the Studio schema
// (sanity/schemaTypes/lead.ts) reads the same stage/source lists so the two
// can never drift apart.

export type StageKey =
  | "new"
  | "contacted"
  | "viewing"
  | "contract"
  | "reserved"
  | "paying"
  | "paid"
  | "handed_over"
  | "lost";

export type StageTone = "attention" | "open" | "won" | "done" | "lost";

export interface StageDef {
  key: StageKey;
  label: string;
  tone: StageTone;
}

export const STAGES: StageDef[] = [
  { key: "new", label: "New enquiry", tone: "attention" },
  { key: "contacted", label: "Contacted", tone: "open" },
  { key: "viewing", label: "Viewing booked", tone: "open" },
  { key: "contract", label: "Offer / contract", tone: "open" },
  { key: "reserved", label: "Reserved", tone: "won" },
  { key: "paying", label: "Paying", tone: "won" },
  { key: "paid", label: "Fully paid", tone: "won" },
  { key: "handed_over", label: "Handed over", tone: "done" },
  { key: "lost", label: "Lost", tone: "lost" },
];

// The pipeline board shows every stage except "lost".
export const BOARD_STAGES = STAGES.filter((s) => s.key !== "lost");

// Stages where a prospect should always have something scheduled next.
export const ACTIVE_STAGES: StageKey[] = ["new", "contacted", "viewing", "contract", "reserved", "paying"];

export const SOURCES = [
  { key: "website", label: "Website" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "phone", label: "Phone call" },
  { key: "meta_ads", label: "Facebook / Instagram ad" },
  { key: "google_ads", label: "Google ad" },
  { key: "referral", label: "Referral" },
  { key: "walk_in", label: "Walk-in / site visit" },
  { key: "other", label: "Other" },
];

export const PAYMENT_PREFS = [
  { key: "undecided", label: "Not decided" },
  { key: "cash", label: "Cash (full payment)" },
  { key: "plan", label: "Payment plan" },
  { key: "mortgage", label: "Mortgage" },
];

export const LOST_REASONS = [
  "Too expensive",
  "Bought elsewhere",
  "No response",
  "Not ready yet",
  "Not happy with the location",
  "Other",
];

export function stageDef(key: string | undefined): StageDef {
  return STAGES.find((s) => s.key === key) ?? STAGES[0];
}

export function stageLabel(key: string | undefined) {
  return stageDef(key).label;
}

export function sourceLabel(key: string | undefined) {
  return SOURCES.find((s) => s.key === key)?.label ?? "Other";
}

export function paymentLabel(key: string | undefined) {
  return PAYMENT_PREFS.find((p) => p.key === key)?.label ?? "Not decided";
}

export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}

// ---- dates -----------------------------------------------------------
// Due dates are plain "YYYY-MM-DD" strings. Ghana has no daylight saving and
// sits on UTC, so the server's UTC date is the same date Niko sees.

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function toUTC(iso: string) {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

export function addDaysISO(iso: string, days: number) {
  return new Date(toUTC(iso) + days * 86_400_000).toISOString().slice(0, 10);
}

// Whole days from `today` to `iso` (negative = in the past).
export function daysUntil(iso: string, today = todayISO()) {
  return Math.round((toUTC(iso) - toUTC(today)) / 86_400_000);
}

export type DueState = "overdue" | "today" | "soon" | "later" | "none";

export function dueState(due: string | undefined, today = todayISO()): DueState {
  if (!due) return "none";
  const d = daysUntil(due, today);
  if (d < 0) return "overdue";
  if (d === 0) return "today";
  if (d <= 7) return "soon";
  return "later";
}

export function dueLabel(due: string | undefined, today = todayISO()) {
  if (!due) return "No date";
  const d = daysUntil(due, today);
  if (d < -1) return `${-d} days overdue`;
  if (d === -1) return "1 day overdue";
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d <= 6) return `In ${d} days`;
  return new Date(toUTC(due)).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}
