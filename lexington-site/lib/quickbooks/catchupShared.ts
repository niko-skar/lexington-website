// A sheet's lines going into QuickBooks at one tap (lib/quickbooks/catchup.ts): what the Spending page shows and
// sends. Shared by the phone and the server, so nothing here talks to anyone.

/** A receipt photo kept with a line, as the page shows it. */
export interface CatchUpReceipt {
  key: string;
  /** The photo itself, and a small copy for the list. */
  url: string;
  thumb: string;
  /** What it is: "Consar proforma 18 m3". */
  caption: string;
}

export interface CatchUpLine {
  /** The line's own key: "r12a" (the sheet's row, and a/b when one row became two). */
  key: string;
  /** Its reference number in QuickBooks: "AUGSEP-12a". */
  ref: string;
  /** A site cost (an Expense in QuickBooks), or money in from Leo (a Deposit). */
  kind: "expense" | "deposit";
  date: string;
  amount: number;
  /** As he typed it on the sheet. */
  description: string;
  /** The QuickBooks supplier (found by name there, or added); none for money in. */
  supplier: string | null;
  /** The QuickBooks class (cost type) and location (floor or stage), by name. */
  className: string | null;
  location: string | null;
  /** The floor his words said ("2nd floor", "Basement"), when they said one. */
  floor: string | null;
  /** Something to look at before sending (a date read as 12 Jul, golf marked Site...). */
  note: string;
  /** A line he should look at (it still goes, unless he unticks it): shown marked, with the note. */
  flag: boolean;
  /** The sheet's row it came from. */
  row: number;
  receipts: CatchUpReceipt[];
  /** In QuickBooks already (sent from here): which transaction, and its photos attached. */
  sent: { type: "Purchase" | "Deposit"; id: string; attached: number } | null;
  /** Left out on a send, and why (QuickBooks had the same day and amount from elsewhere). */
  left: string | null;
}

export interface CatchUp {
  /** The sheet's batch: "aug-sep-2026". */
  batch: string;
  title: string;
  lines: CatchUpLine[];
}

/** What the Spending page's card says about a batch. */
export interface CatchUpSummary {
  batch: string;
  title: string;
  /** Not in QuickBooks yet, and not left out. */
  toSend: number;
  toSendAmount: number;
  sent: number;
  left: number;
}

export interface CatchUpResult {
  key: string;
  outcome: "sent" | "already" | "left" | "failed";
  /** Why it was left out or failed. */
  why?: string;
}

/** Lines in one request: each can take a few seconds with its photos, and a request has a minute. */
export const CATCHUP_PER_SEND = 6;

export const catchUpSummary = (c: CatchUp): CatchUpSummary => {
  const waiting = c.lines.filter((l) => !l.sent && !l.left);
  return {
    batch: c.batch,
    title: c.title,
    toSend: waiting.length,
    toSendAmount: Math.round(waiting.reduce((n, l) => n + l.amount, 0) * 100) / 100,
    sent: c.lines.filter((l) => l.sent).length,
    left: c.lines.filter((l) => l.left).length,
  };
};
