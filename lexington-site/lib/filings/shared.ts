// Tax & filings (21 Nov 2026, Niko: "i've now registered the company so you need to make deadlines, and automated
// forms to submit super easy so I can remain fully compliant. including shortly VAT filings"). Olympian Developments
// Ltd was incorporated on 17 Nov 2026 (Form 3). This file holds what the company must file, when, and the figures for
// the monthly returns worked out from what the app already keeps (buyer payments, expenses, Payday's wages). It runs
// on the server and in the page alike (no server-only imports).
//
// Where each rule comes from (checked 21 Nov 2026):
// - VAT: the VAT Act 2025 (Act 1151) itself (Claude/Tax research has the text): return and payment by the last working
//   day of the next month even when nothing is owed (s.59(5), s.60(1)); tax invoices through GRA's E-VAT (s.43(2));
//   register within 30 days of passing GH₵750,000 in 12 months (s.6). 15% VAT + 2.5% NHIL + 2.5% GETFund.
// - PAYE and withholding tax: by the 15th of the next month (GRA's WHT page; PwC). GRA's own 2026 calendar moves a
//   15th on a weekend to the Friday before, so every date here moves back to a working day, never forward.
//   Casual (daily-paid) workers: 5% kept back (GRA's PAYE page). Salaries: the bands in force from 1 Sep 2026
//   (Income Tax (Amendment) Act 2026, GRA's PAYE page). WHT: goods 3%, works 5%, services 7.5% once a supplier's
//   payments pass GH₵2,000 in the year (GRA's WHT page).
// - SSNIT: 13% from the company and 5.5% from the employee; 13.5% to SSNIT and 5% to the Tier 2 trustee by the 14th.
// - Company tax: estimate in the first quarter, instalments 31 Mar / 30 Jun / 30 Sep / 31 Dec, return 4 months after
//   the year end (GRA's CIT page; PwC); Growth and Sustainability Levy 2.5% of profit before tax to 2028 (Act 1131).
// - Registrar: first annual return within 18 months of incorporation, then every year, with audited accounts (s.126
//   as the Registrar quotes it). Data Protection: register, renew every 2 years (DPC).
// Rules marked sure: false come from practice or second-hand sources: the page says to check them with the accountant.

/* ---------- dates ---------- */

const DAY_MS = 86_400_000;
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const toDate = (day: string) => new Date(`${day}T12:00:00Z`);
const toDay = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => toDay(new Date(toDate(day).getTime() + n * DAY_MS));
export const daysBetween = (from: string, to: string) => Math.round((toDate(to).getTime() - toDate(from).getTime()) / DAY_MS);
const pad = (n: number) => String(n).padStart(2, "0");
export const dayOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
/** The last day of a month (m 1-12). */
export const lastDay = (y: number, m: number) => dayOf(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate());
/** "2026-11" -> "2026-12". */
export const nextMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
};
export const prevMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
};
export const addMonths = (day: string, n: number) => {
  const [y, m, d] = day.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  const ny = Math.floor(t / 12);
  const nm = (t % 12) + 1;
  return dayOf(ny, nm, Math.min(d, Number(lastDay(ny, nm).slice(8))));
};
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-11" -> "November 2026". */
export const monthName = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/** Easter Sunday (Gregorian, the anonymous algorithm). */
function easter(y: number): string {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return dayOf(y, month, day);
}

/**
 * Ghana's public holidays with a fixed or worked-out date. The two Eids follow the moon and are announced late, so
 * they're not here: dates only ever move earlier for a holiday, and the reminders start two weeks ahead anyway.
 */
export function holidays(y: number): Set<string> {
  const e = easter(y);
  const firstFridayDec = (() => {
    for (let d = 1; d <= 7; d += 1) if (new Date(Date.UTC(y, 11, d)).getUTCDay() === 5) return dayOf(y, 12, d);
    return dayOf(y, 12, 1);
  })();
  return new Set([
    dayOf(y, 1, 1), // New Year
    dayOf(y, 1, 7), // Constitution Day
    dayOf(y, 3, 6), // Independence Day
    addDays(e, -2), // Good Friday
    addDays(e, 1), // Easter Monday
    dayOf(y, 5, 1), // May Day
    dayOf(y, 7, 1), // Republic Day
    dayOf(y, 8, 4), // Founders' Day
    dayOf(y, 9, 21), // Kwame Nkrumah Memorial Day
    firstFridayDec, // Farmers' Day
    dayOf(y, 12, 25),
    dayOf(y, 12, 26),
  ]);
}
export function isWorkingDay(day: string): boolean {
  const w = toDate(day).getUTCDay();
  return w !== 0 && w !== 6 && !holidays(Number(day.slice(0, 4))).has(day);
}
/** The day itself if it's a working day, else the working day before it (filing early is always fine). */
export function workingDayOnOrBefore(day: string): string {
  let d = day;
  for (let i = 0; i < 10 && !isWorkingDay(d); i += 1) d = addDays(d, -1);
  return d;
}

/* ---------- the rules ---------- */

export type Freq = "once" | "monthly" | "quarterly" | "yearly" | "two-yearly";
export type FormKind = "vat" | "paye" | "wht" | "ssnit";
/** What switches a rule on: always, the VAT registration date, the first month the company pays the site, the DPC date. */
export type Starts = "now" | "vat" | "pay" | "dpc";

export interface Rule {
  id: string;
  name: string;
  who: string;
  freq: Freq;
  starts: Starts;
  /** Why it matters, in a line. */
  why: string;
  /** What to do, step by step. */
  how: string[];
  link: { label: string; url: string } | null;
  /** The law or source behind the date (null: a practical step, not a legal one). */
  basis: string | null;
  /** false: from practice or second-hand sources: the page says to check it with the accountant. */
  sure: boolean;
  /** The ready-to-file figures, for a monthly return. */
  form: FormKind | null;
  /** A one-off task: the day to aim for. */
  by?: string;
}

const GRA = { label: "GRA's website", url: "https://gra.gov.gh/" };

/** The one-off things to set the company up (in the order to do them). */
export const SETUP: Rule[] = [
  {
    id: "bank",
    name: "Open the company's bank account",
    who: "Your bank",
    freq: "once",
    starts: "now",
    by: "2026-12-04",
    why: "The company's taxes, SSNIT and suppliers are paid from it, and buyers pay into it.",
    how: [
      "Take the certificate of incorporation, Form 3, the constitution and both directors' Ghana Cards to the bank.",
      "Ask for a cedi account and a dollar account in the company's name.",
    ],
    link: null,
    basis: null,
    sure: true,
    form: null,
  },
  {
    id: "vat-register",
    name: "Register the company for VAT",
    who: "GRA",
    freq: "once",
    starts: "now",
    by: "2026-12-11",
    why: "A business must register within 30 days after its sales pass GH₵750,000 in 12 months. One apartment sale passes it, so register before the company takes sale money.",
    how: [
      "Apply on GRA's online portal or at your Taxpayer Service Centre, with the certificate of incorporation, Form 3 and the directors' Ghana Cards.",
      "When GRA confirms, type the date VAT starts under Company details below. The monthly VAT returns then appear here by themselves.",
    ],
    link: GRA,
    basis: "VAT Act 2025 (Act 1151) s.6",
    sure: true,
    form: null,
  },
  {
    id: "evat",
    name: "Ask GRA for E-VAT invoicing",
    who: "GRA",
    freq: "once",
    starts: "now",
    by: "2026-12-11",
    why: "Once registered, every VAT invoice has to come from GRA's E-VAT system, including one for each buyer payment.",
    how: ["Write to your Taxpayer Service Centre asking for the E-VAT system. GRA installs it free for businesses without their own invoicing system."],
    link: { label: "GRA's E-VAT page", url: "https://gra.gov.gh/e-vat/" },
    basis: "VAT Act 2025 (Act 1151) s.43(2)",
    sure: true,
    form: null,
  },
  {
    id: "orc-email",
    name: "Fix the company's email at the Registrar",
    who: "Registrar of Companies",
    freq: "once",
    starts: "now",
    by: "2026-12-11",
    why: "Form 3 says info@olypiandevelopment.com, which is misspelt, so the Registrar's emails won't reach you.",
    how: ["File a change of particulars on the Registrar's online portal with info@olympiandevelopments.com."],
    link: { label: "Registrar's website", url: "https://orc.gov.gh/" },
    basis: "Form 3, 20 Nov 2026",
    sure: true,
    form: null,
  },
  {
    id: "bop",
    name: "Get the Business Operating Permit",
    who: "Ayawaso West Municipal Assembly",
    freq: "once",
    starts: "now",
    by: "2026-12-31",
    why: "Form 3 shows the permit was asked for, but it has no reference number yet. It's renewed every year.",
    how: ["Ask the Assembly (or the Registrar's permit desk) for the permit and its reference number, and pay the fee."],
    link: null,
    basis: "Form 3 Part XII",
    sure: false,
    form: null,
  },
  {
    id: "ssnit-register",
    name: "Register with SSNIT as an employer",
    who: "SSNIT",
    freq: "once",
    starts: "now",
    by: "2026-12-31",
    why: "Before the company pays its first salaries. It then pays 13% on top of each salary and keeps back 5.5%.",
    how: [
      "Register at an SSNIT branch or on SSNIT's employer portal, and choose a Tier 2 pension trustee.",
      "Then add the staff on salaries under Company details below.",
    ],
    link: { label: "SSNIT's website", url: "https://www.ssnit.org.gh/" },
    basis: "National Pensions Act 2008 (Act 766)",
    sure: true,
    form: null,
  },
  {
    id: "tax-2026",
    name: "Ask the accountant about tax for 2026",
    who: "GRA",
    freq: "once",
    starts: "now",
    by: "2026-12-31",
    why: "The company started on 17 Nov 2026. GRA wants an estimate of each year's profit and quarterly instalments, so check what's needed for 17 Nov to 31 Dec 2026.",
    how: ["Ask your accountant. If an estimate is due, it's filed on GRA's portal."],
    link: GRA,
    basis: "Income Tax Act 2015 (Act 896); GRA's company tax page",
    sure: false,
    form: null,
  },
  {
    id: "dpc",
    name: "Register with the Data Protection Commission",
    who: "Data Protection Commission",
    freq: "once",
    starts: "now",
    by: "2027-01-29",
    why: "The buyer portal and the customer list hold people's details. A company that keeps them must register, and renew every 2 years.",
    how: [
      "Register on the Commission's portal and pay the fee for the company's size.",
      "Type the date it's done under Company details below: the renewal then shows up here.",
    ],
    link: { label: "DPC registration", url: "https://app.dpc.gov.gh/register" },
    basis: "Data Protection Act 2012 (Act 843) s.27, s.50",
    sure: true,
    form: null,
  },
  {
    id: "fic",
    name: "Ask about anti-money-laundering (FIC)",
    who: "Financial Intelligence Centre",
    freq: "once",
    starts: "now",
    by: "2027-01-29",
    why: "Real estate businesses come under the Anti-Money Laundering Act. A suspicious payment must be reported within 24 hours, and cash payments may need reporting.",
    how: ["Ask your lawyer whether the company must register on the FIC's goAML portal, and who its reporting officer should be."],
    link: { label: "FIC goAML portal", url: "https://reporting.fic.gov.gh/Home" },
    basis: "Anti-Money Laundering Act 2020 (Act 1044)",
    sure: false,
    form: null,
  },
  {
    id: "gipa",
    name: "Check the investment authority (GIPA)",
    who: "Ghana Investment Promotion Authority",
    freq: "once",
    starts: "now",
    by: "2027-01-29",
    why: "A company with a shareholder recorded as foreign counts as having foreign participation. The GIPA Act 2026 dropped the minimum capital for joint ventures, but registering may still apply.",
    how: ["Check the nationalities on Form 3, then ask your lawyer. A shareholder who is also a Ghanaian citizen can ask the Registrar to record it."],
    link: null,
    basis: "GIPA Act 2026 (Act 1173)",
    sure: false,
    form: null,
  },
];

/** What comes back every month, quarter or year. */
export const RECURRING: Rule[] = [
  {
    id: "vat",
    name: "VAT return",
    who: "GRA",
    freq: "monthly",
    starts: "vat",
    why: "Every month from VAT registration, even a month with nothing to pay.",
    how: [
      "Check the figures: the VAT in each buyer payment, less the VAT on the company's bills.",
      "On GRA's portal, open the month's VAT return and type in the boxes.",
      "Pay what it says by the same day.",
      "Tap Filed and type GRA's reference.",
    ],
    link: GRA,
    basis: "VAT Act 2025 (Act 1151) s.59(5), s.60",
    sure: true,
    form: "vat",
  },
  {
    id: "paye",
    name: "PAYE: workers' tax",
    who: "GRA",
    freq: "monthly",
    starts: "pay",
    why: "Tax kept back from wages: 5% of a daily-paid (casual) worker's pay, and the PAYE on each salary.",
    how: [
      "Keep the tax back when paying (the figures show how much).",
      "File the return and pay it on GRA's portal.",
      "Tap Filed and type GRA's reference.",
    ],
    link: GRA,
    basis: "Income Tax Act 2015 (Act 896); GRA's PAYE page",
    sure: true,
    form: "paye",
  },
  {
    id: "wht",
    name: "Withholding tax on suppliers",
    who: "GRA",
    freq: "monthly",
    starts: "pay",
    why: "When paying a supplier, the company keeps back 3% for goods, 5% for building work and 7.5% for services, once it has paid them over GH₵2,000 in the year.",
    how: [
      "Pay the supplier the price less the tax, and give them proof of the tax kept back.",
      "File the list on GRA's portal and pay the tax kept back.",
      "Tap Filed and type GRA's reference.",
    ],
    link: GRA,
    basis: "Income Tax Act 2015 (Act 896); GRA's withholding tax page",
    sure: true,
    form: "wht",
  },
  {
    id: "ssnit",
    name: "SSNIT contributions",
    who: "SSNIT",
    freq: "monthly",
    starts: "pay",
    why: "18.5% of each salary: 13% from the company, 5.5% kept back from the employee.",
    how: ["Pay 13.5% to SSNIT with the month's contribution report.", "Pay the other 5% to your Tier 2 pension trustee.", "Tap Filed and type the payment reference."],
    link: { label: "SSNIT's website", url: "https://www.ssnit.org.gh/" },
    basis: "National Pensions Act 2008 (Act 766)",
    sure: true,
    form: "ssnit",
  },
  {
    id: "cit-estimate",
    name: "Company tax estimate",
    who: "GRA",
    freq: "yearly",
    starts: "now",
    why: "The year's expected profit, which the quarterly instalments are worked out from.",
    how: ["Your accountant files the estimate on GRA's portal.", "While there's no profit yet, it can be nil."],
    link: GRA,
    basis: "GRA's company tax page (first quarter of the year)",
    sure: true,
    form: null,
  },
  {
    id: "cit-q",
    name: "Company tax instalment",
    who: "GRA",
    freq: "quarterly",
    starts: "now",
    why: "A quarter of the year's estimated company tax (25% of profit), with the Growth and Sustainability Levy (2.5% of profit before tax, to 2028).",
    how: ["Pay the instalment from the estimate on GRA's portal. A nil estimate means nothing to pay."],
    link: GRA,
    basis: "Revenue Administration Act 2016 (Act 915); GRA's company tax page; Growth and Sustainability Levy Act 2023 (Act 1095), extended by Act 1131",
    sure: true,
    form: null,
  },
  {
    id: "cit-return",
    name: "Company tax return",
    who: "GRA",
    freq: "yearly",
    starts: "now",
    why: "The year's return with the audited accounts, 4 months after the year ends.",
    how: ["Your accountant files the return with the accounts audited by the company's auditor (on Form 3).", "Pay any tax still owed by the same day."],
    link: GRA,
    basis: "Revenue Administration Act 2016 (Act 915); GRA's company tax page",
    sure: true,
    form: null,
  },
  {
    id: "paye-annual",
    name: "Employer's annual PAYE return",
    who: "GRA",
    freq: "yearly",
    starts: "pay",
    why: "Every employee's pay and tax for the year.",
    how: ["File it on GRA's portal. The monthly PAYE figures here add up to it."],
    link: GRA,
    basis: "Income Tax Act 2015 (Act 896); GRA: by 30 April",
    sure: true,
    form: null,
  },
  {
    id: "orc-annual",
    name: "Annual return to the Registrar",
    who: "Registrar of Companies",
    freq: "yearly",
    starts: "now",
    why: "The first within 18 months of incorporation, then every year, with the audited accounts. Late filing costs GH₵1,000 a month.",
    how: [
      "Approve the year's audited accounts first (at the annual general meeting, or by a written resolution of the shareholders) and re-appoint the auditor.",
      "File the return with the accounts on the Registrar's portal and pay the fee. As company secretary, this one is yours.",
    ],
    link: { label: "Registrar's website", url: "https://orc.gov.gh/" },
    basis: "Companies Act 2019 (Act 992) s.126",
    sure: false,
    form: null,
  },
  {
    id: "bop-renew",
    name: "Business Operating Permit renewal",
    who: "Ayawaso West Municipal Assembly",
    freq: "yearly",
    starts: "now",
    why: "The Assembly's permit is renewed each year.",
    how: ["Pay the year's permit fee at the Assembly and keep the permit."],
    link: null,
    basis: null,
    sure: false,
    form: null,
  },
  {
    id: "dpc-renew",
    name: "Data Protection renewal",
    who: "Data Protection Commission",
    freq: "two-yearly",
    starts: "dpc",
    why: "The registration lasts 2 years; the portal takes renewals from 3 months before.",
    how: ["Renew on the Commission's portal with the compliance report and the fee."],
    link: { label: "DPC registration", url: "https://app.dpc.gov.gh/register" },
    basis: "Data Protection Act 2012 (Act 843) s.50",
    sure: true,
    form: null,
  },
];

export const RULES: Rule[] = [...SETUP, ...RECURRING];
export const ruleById = (id: string) => RULES.find((r) => r.id === id) ?? null;

/* ---------- settings and records ---------- */

export interface Company {
  name: string;
  regNo: string;
  tin: string;
  incorporated: string;
  address: string;
  auditor: string;
}
export type WhtType = "goods" | "works" | "services" | "none";
export const WHT_RATE: Record<Exclude<WhtType, "none">, number> = { goods: 3, works: 5, services: 7.5 };
export const WHT_WORDS: Record<WhtType, string> = { goods: "Goods 3%", works: "Building work 5%", services: "Services 7.5%", none: "No WHT" };
/** WHT applies once a supplier's payments in the year pass this (GRA: "exceeding GH¢2,000 per annum"). */
export const WHT_THRESHOLD = 2000;

export interface Staff {
  id: string;
  name: string;
  /** Monthly gross salary, GH₵. */
  salary: number;
  /** On SSNIT (13% + 5.5%). */
  ssnit: boolean;
  /** From this month (YYYY-MM). */
  from: string;
  /** Until this month (YYYY-MM), or null. */
  until: string | null;
}

export interface FilingSettings {
  company: Company | null;
  /** The day VAT registration took effect (YYYY-MM-DD), or null. */
  vatFrom: string | null;
  /** The first month the company pays the site's wages and suppliers itself (YYYY-MM), or null. */
  payFrom: string | null;
  /** The day the company registered with the Data Protection Commission, or null. */
  dpcFrom: string | null;
  staff: Staff[];
  /** By supplier (lower case): the WHT kind and their TIN. */
  suppliers: Record<string, { type?: WhtType; tin?: string }>;
  /** By buyer id: their payments carry the company's VAT (true) or not (false); unset: buyers whose first payment is on or after the VAT date. */
  vatBuyers: Record<string, boolean>;
  /** By buyer payment key: GH₵ for one US$ on the day it was paid (Bank of Ghana's rate). */
  rates: Record<string, number>;
  /** The one-off tasks done: by rule id. */
  setup: Record<string, { at: string; by: string; note: string | null }>;
}
export const EMPTY_SETTINGS: FilingSettings = { company: null, vatFrom: null, payFrom: null, dpcFrom: null, staff: [], suppliers: {}, vatBuyers: {}, rates: {}, setup: {} };

export interface FilingRecord {
  rule: string;
  period: string;
  /** Filed (and paid), or not needed this time. */
  status: "filed" | "skipped";
  /** The day it was filed. */
  on: string;
  ref: string | null;
  paid: number | null;
  note: string | null;
  by: string;
  at: string;
}
export const recordKey = (rule: string, period: string) => `${rule}:${period}`;

/* ---------- the calendar ---------- */

export interface DueItem {
  key: string;
  rule: string;
  period: string;
  /** "VAT return · November 2026". */
  title: string;
  who: string;
  /** The law's date. */
  legal: string;
  /** The day to file by: the law's date, or the working day before it. */
  by: string;
  /** Days from today to "by" (negative: late). */
  days: number;
  status: "filed" | "skipped" | "late" | "due" | "later";
  record: FilingRecord | null;
  form: FormKind | null;
  /** The figures' total to pay, when worked out (set by the server). */
  amount?: number | null;
  sure: boolean;
}

const QUARTER_ENDS = [
  [3, 31],
  [6, 30],
  [9, 30],
  [12, 31],
] as const;

/** Every period of a rule whose date is within [from, to], or late and not filed. */
function periods(rule: Rule, s: FilingSettings, firstYear: number, untilDay: string, monthlyUntil: string): Array<{ period: string; legal: string; title: string }> {
  const out: Array<{ period: string; legal: string; title: string }> = [];
  const lastYear = Number(untilDay.slice(0, 4)) + 1;
  if (rule.freq === "monthly") {
    const start = rule.starts === "vat" ? s.vatFrom?.slice(0, 7) : rule.starts === "pay" ? s.payFrom : null;
    if (!start) return out;
    for (let m = start; m <= monthlyUntil; m = nextMonth(m)) {
      const due = nextMonth(m);
      const [y, mm] = due.split("-").map(Number);
      const legal = rule.id === "vat" ? lastDay(y, mm) : dayOf(y, mm, rule.id === "ssnit" ? 14 : 15);
      out.push({ period: m, legal, title: `${rule.name} · ${monthName(m)}` });
    }
    return out;
  }
  if (rule.freq === "quarterly") {
    for (let y = Math.max(firstYear + 1, 2027); y <= lastYear; y += 1) {
      QUARTER_ENDS.forEach(([m, d], i) => out.push({ period: `${y}-Q${i + 1}`, legal: dayOf(y, m, d), title: `${rule.name} · Q${i + 1} ${y}` }));
    }
    return out;
  }
  if (rule.freq === "yearly") {
    for (let y = firstYear; y <= lastYear; y += 1) {
      if (rule.id === "cit-return") out.push({ period: String(y), legal: dayOf(y + 1, 4, 30), title: `${rule.name} · ${y}` });
      else if (rule.id === "cit-estimate" && y >= 2027) out.push({ period: String(y), legal: dayOf(y, 3, 31), title: `${rule.name} · ${y}` });
      else if (rule.id === "paye-annual" && s.payFrom && y >= Number(s.payFrom.slice(0, 4))) out.push({ period: String(y), legal: dayOf(y + 1, 4, 30), title: `${rule.name} · ${y}` });
      // The first within 18 months of incorporation (17 May 2028, with the accounts to the end of 2027), then yearly.
      else if (rule.id === "orc-annual" && y >= 2027) out.push({ period: String(y), legal: y === 2027 ? "2028-05-17" : dayOf(y + 1, 4, 30), title: `${rule.name} · ${y} accounts` });
      else if (rule.id === "bop-renew" && y >= 2027) out.push({ period: String(y), legal: dayOf(y, 3, 31), title: `${rule.name} · ${y}` });
    }
    return out;
  }
  if (rule.freq === "two-yearly" && s.dpcFrom) {
    for (let n = 1; n <= 5; n += 1) {
      const legal = addDays(addMonths(s.dpcFrom, 24 * n), -1);
      out.push({ period: legal.slice(0, 4), legal, title: `${rule.name} · ${legal.slice(0, 4)}` });
      if (legal > untilDay) break;
    }
  }
  return out;
}

/**
 * The company's calendar: every one-off task not done, and every return from a while ago (or late and not filed) to a
 * year ahead, soonest first.
 */
export function calendar(s: FilingSettings, records: Record<string, FilingRecord>, today: string, ahead = 400, back = 120): DueItem[] {
  const until = addDays(today, ahead);
  const since = addDays(today, -back);
  const firstYear = Number((s.company?.incorporated ?? "2026-11-17").slice(0, 4));
  const items: DueItem[] = [];
  // Monthly returns: this month's and next month's (the pattern is plain; a year of them would bury the rest).
  const monthlyUntil = nextMonth(today.slice(0, 7));
  for (const rule of RECURRING) {
    for (const p of periods(rule, s, firstYear, until, monthlyUntil)) {
      const by = workingDayOnOrBefore(p.legal);
      const record = records[recordKey(rule.id, p.period)] ?? null;
      const days = daysBetween(today, by);
      const status: DueItem["status"] = record ? record.status : days < 0 ? "late" : days <= 45 ? "due" : "later";
      if (by > until) continue;
      if (record && by < since) continue;
      items.push({ key: recordKey(rule.id, p.period), rule: rule.id, period: p.period, title: p.title, who: rule.who, legal: p.legal, by, days, status, record, form: rule.form, sure: rule.sure });
    }
  }
  return items.sort((a, b) => a.by.localeCompare(b.by) || a.title.localeCompare(b.title));
}

export interface SetupItem {
  rule: Rule;
  done: { at: string; by: string; note: string | null } | null;
  days: number;
}
export const setupList = (s: FilingSettings, today: string): SetupItem[] =>
  SETUP.map((rule) => ({ rule, done: s.setup[rule.id] ?? null, days: rule.by ? daysBetween(today, rule.by) : 0 }));

/* ---------- money ---------- */

export const round2 = (n: number) => Math.round(n * 100) / 100;
/** VAT 15%, NHIL 2.5%, GETFund 2.5% of the value before tax (Act 1151: each on the same value, 20% in all). */
export const VAT_PARTS = [
  { key: "vat", label: "VAT 15%", rate: 15 },
  { key: "nhil", label: "NHIL 2.5%", rate: 2.5 },
  { key: "getfund", label: "GETFund 2.5%", rate: 2.5 },
] as const;
export const VAT_TOTAL = 20;
/** A price with the VAT in it: its value before tax and each part of the tax. */
export function splitVat(gross: number, totalRate = VAT_TOTAL): { value: number; vat: number; nhil: number; getfund: number; tax: number } {
  const value = round2((gross * 100) / (100 + totalRate));
  const tax = round2(gross - value);
  const vat = round2((tax * 15) / VAT_TOTAL);
  const nhil = round2((tax * 2.5) / VAT_TOTAL);
  return { value, vat, nhil, getfund: round2(tax - vat - nhil), tax };
}

/** Monthly PAYE bands for residents: [band width, percent]. From 1 Sep 2026 (Income Tax (Amendment) Act 2026, GRA). */
const BANDS_2026: Array<[number, number]> = [
  [588, 0],
  [80, 5],
  [100, 10],
  [2900, 17.5],
  [16000, 25],
  [30332, 30],
  [Infinity, 35],
];
/** Before September 2026 (the 2024 bands). */
const BANDS_2024: Array<[number, number]> = [
  [490, 0],
  [110, 5],
  [130, 10],
  [3166.67, 17.5],
  [16000, 25],
  [30520, 30],
  [Infinity, 35],
];
/** PAYE on a month's chargeable pay (after the employee's 5.5% SSNIT). */
export function payeOn(chargeable: number, month: string): number {
  let left = Math.max(0, chargeable);
  let tax = 0;
  for (const [width, pct] of month >= "2026-09" ? BANDS_2026 : BANDS_2024) {
    const part = Math.min(left, width);
    tax += (part * pct) / 100;
    left -= part;
    if (left <= 0) break;
  }
  return round2(tax);
}
export const CASUAL_RATE = 5;
export const SSNIT_EMPLOYEE = 5.5;
export const SSNIT_EMPLOYER = 13;
export const SSNIT_TIER1 = 13.5;
export const SSNIT_TIER2 = 5;

/** The WHT kind a payment most likely is, from its category and cost type (each supplier can be set otherwise). */
export function whtGuess(x: { category: string | null; costClass: string | null; supplier: string; description: string }): WhtType {
  const text = `${x.costClass ?? ""} ${x.description}`.toLowerCase();
  const who = x.supplier.trim();
  if (/\bbank (fee|charge)|\be-?levy\b|\bmomo fee\b/.test(text) || /^(fidelity bank|gra|ssnit|ghana revenue authority|leo)$/i.test(who)) return "none";
  // Companies abroad (ads, software): not this return (the sheet's notes say so).
  if (ABROAD_RE.test(who)) return "none";
  if (x.category === "Material") return "goods";
  if (/fuel|diesel|petrol|gas\b/.test(text)) return "goods";
  if (/security|guard|transport|haulage|delivery|truck hire|rental|\bhire\b|consult|survey|legal|lawyer|audit|accountant|advert|internet|airtime/.test(text)) return "services";
  if (/^labour|labour|mason|carpent|steel bend|bending|workmanship|plumb|electric(al)? work|tiling|painting|welding|contractor/.test(text)) return "works";
  if (x.category === "Service") return "services";
  return "goods";
}
export const supplierKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");
/** Paid to companies abroad (card payments for ads and software). */
const ABROAD_RE = /^(google|meta|facebook|instagram|tiktok|linkedin|microsoft|apple|amazon|openai|anthropic|claude|vercel|sanity|intuit|quickbooks|canva|adobe|zoom)\b/i;
/** Wages: Payday's entries, and the ones typed in Expenses before Payday moved into the app (2 Nov 2026). */
export const isWages = (x: Pick<FormExpense, "wages" | "machines" | "supplier" | "description">) =>
  !!x.wages || (!x.machines && (/^site workers$/i.test(x.supplier.trim()) || /^wages\b/i.test(x.description.trim())));

/* ---------- the forms ---------- */

export interface FormExpense {
  id: string;
  ref: string | null;
  date: string;
  forWho: string;
  amount: number;
  vat: boolean;
  vatRate: number | null;
  supplier: string;
  description: string;
  category: string | null;
  costClass: string | null;
  receipt: boolean;
  /** Payday's wage lines (workers), or null. */
  wages: Array<{ id: string; name: string; amount: number; at: string }> | null;
  machines: boolean;
}
export interface FormBuyer {
  id: string;
  name: string;
  unit: string | null;
  payments: Array<{ key: string; amount: number; currency: "GHS" | "USD"; exchangeRate: number | null; date: string | null; method: string | null; receipt: string | null }>;
}
export interface FormInputs {
  expenses: FormExpense[];
  buyers: FormBuyer[];
  /** The last cedi rate a buyer payment used (a starting point for a dollar payment's rate). */
  lastRate: number | null;
}

export interface SheetRow {
  cells: string[];
  /** A button on the row: set this buyer's VAT, this payment's rate, this supplier's WHT kind. */
  action?: { kind: "buyer" | "rate" | "supplier"; id: string; label: string };
  warn?: string;
  muted?: boolean;
}
export interface SheetTable {
  title: string;
  columns: string[];
  rows: SheetRow[];
  empty: string;
}
export interface Sheet {
  form: FormKind;
  period: string;
  title: string;
  /** Why these figures aren't for filing (a month before the start), or null. */
  practice: string | null;
  /** The return's boxes, in the order the portal asks. */
  boxes: Array<{ label: string; amount: number; strong?: boolean; note?: string }>;
  tables: SheetTable[];
  notes: string[];
  /** What to pay, and to whom (null: nothing). */
  pay: { amount: number; to: string } | null;
}

const money2 = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = (day: string) => toDate(day).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const inMonth = (day: string | null | undefined, month: string) => !!day && day.slice(0, 7) === month;
const COMPANY = new Set(["Site", "Event"]);

/** Does this buyer's money carry the company's VAT? Set by hand, else: their first payment is on or after the VAT date. */
export function buyerHasVat(b: FormBuyer, s: FilingSettings): boolean {
  if (typeof s.vatBuyers[b.id] === "boolean") return s.vatBuyers[b.id];
  if (!s.vatFrom) return false;
  const first = b.payments.map((p) => p.date).filter((d): d is string => !!d).sort()[0];
  return !!first && first >= s.vatFrom;
}

interface VatMonth {
  output: { value: number; vat: number; nhil: number; getfund: number; tax: number };
  input: { gross: number; tax: number; vat: number; nhil: number; getfund: number };
  rows: { out: SheetRow[]; inp: SheetRow[] };
  missingRate: number;
}
function vatMonth(month: string, inputs: FormInputs, s: FilingSettings, from: string | null): VatMonth {
  const out: SheetRow[] = [];
  const output = { value: 0, vat: 0, nhil: 0, getfund: 0, tax: 0 };
  let missingRate = 0;
  for (const b of inputs.buyers) {
    const on = buyerHasVat(b, s);
    for (const p of b.payments) {
      if (!inMonth(p.date, month) || (from && p.date! < from)) continue;
      const rate = p.currency === "USD" ? (s.rates[p.key] ?? null) : 1;
      const ghs = rate ? round2(p.amount * rate) : null;
      const label = p.currency === "USD" ? `US$ ${p.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `GH₵ ${money2(p.amount)}`;
      if (!on) {
        out.push({ cells: [short(p.date!), `${b.name}${b.unit ? ` (${b.unit})` : ""}`, p.receipt ?? "", label, "No company VAT", "", ""], muted: true, action: { kind: "buyer", id: b.id, label: "Change" } });
        continue;
      }
      if (ghs === null) {
        missingRate += 1;
        out.push({ cells: [short(p.date!), `${b.name}${b.unit ? ` (${b.unit})` : ""}`, p.receipt ?? "", label, "?", "?", "?"], warn: "Type the Bank of Ghana dollar rate for this day", action: { kind: "rate", id: p.key, label: "Rate" } });
        continue;
      }
      const x = splitVat(ghs);
      output.value += x.value;
      output.vat += x.vat;
      output.nhil += x.nhil;
      output.getfund += x.getfund;
      output.tax += x.tax;
      out.push({
        cells: [short(p.date!), `${b.name}${b.unit ? ` (${b.unit})` : ""}`, p.receipt ?? "", `${label}${p.currency === "USD" ? ` at ${rate}` : ""}`, money2(ghs), money2(x.value), money2(x.tax)],
        action: p.currency === "USD" ? { kind: "rate", id: p.key, label: "Rate" } : { kind: "buyer", id: b.id, label: "Change" },
      });
    }
  }
  const inp: SheetRow[] = [];
  const input = { gross: 0, tax: 0, vat: 0, nhil: 0, getfund: 0 };
  for (const x of inputs.expenses) {
    if (!x.vat || !COMPANY.has(x.forWho) || !inMonth(x.date, month) || (from && x.date < from)) continue;
    const t = splitVat(x.amount, x.vatRate && x.vatRate > 0 ? x.vatRate : VAT_TOTAL);
    input.gross += x.amount;
    input.tax += t.tax;
    input.vat += t.vat;
    input.nhil += t.nhil;
    input.getfund += t.getfund;
    inp.push({ cells: [short(x.date), x.supplier, x.ref ?? "", x.description, money2(x.amount), money2(t.tax)], warn: x.receipt ? undefined : "No receipt photo: GRA only allows VAT with the company's VAT invoice" });
  }
  for (const k of ["value", "vat", "nhil", "getfund", "tax"] as const) output[k] = round2(output[k]);
  for (const k of ["gross", "tax", "vat", "nhil", "getfund"] as const) input[k] = round2(input[k]);
  return { output, input, rows: { out, inp }, missingRate };
}

/** The VAT credit carried into a month: each month's net from the VAT date, a credit carried on. */
function vatCredit(month: string, inputs: FormInputs, s: FilingSettings): number {
  if (!s.vatFrom) return 0;
  let credit = 0;
  for (let m = s.vatFrom.slice(0, 7); m < month; m = nextMonth(m)) {
    const v = vatMonth(m, inputs, s, s.vatFrom);
    const net = v.output.tax - v.input.tax - credit;
    credit = net < 0 ? round2(-net) : 0;
  }
  return credit;
}

export function vatSheet(month: string, inputs: FormInputs, s: FilingSettings): Sheet {
  const practice = !s.vatFrom
    ? "Practice only: type the day VAT registration starts under Company details, and the real returns start from that month."
    : month < s.vatFrom.slice(0, 7)
      ? `Practice only: the company's VAT starts ${short(s.vatFrom)} ${s.vatFrom.slice(0, 4)}.`
      : null;
  const from = practice ? null : s.vatFrom;
  // Practice months count every buyer's payments as the company's, to show what the figures would be.
  const counted: FilingSettings = practice ? { ...s, vatBuyers: Object.fromEntries(inputs.buyers.map((b) => [b.id, s.vatBuyers[b.id] ?? true])) } : s;
  const v = vatMonth(month, inputs, counted, from);
  const credit = practice ? 0 : vatCredit(month, inputs, s);
  const net = round2(v.output.tax - v.input.tax - credit);
  const notes = [
    "Each buyer payment counts in the month it's received (VAT Act 2025 s.39): the price includes VAT, so the VAT is 20/120 of it.",
    "Dollar payments count in cedis at the Bank of Ghana rate for the day: tap Rate on a dollar payment to type it.",
    "Only bills in the company's name with its TIN, from a VAT-registered supplier, let the company take their VAT off. Mark VAT on an expense when you log it.",
    "Every buyer payment needs an E-VAT invoice from GRA's system.",
  ];
  if (v.missingRate) notes.unshift(`${v.missingRate} dollar ${v.missingRate === 1 ? "payment has" : "payments have"} no rate yet, so ${v.missingRate === 1 ? "it isn't" : "they aren't"} counted.`);
  if (s.vatFrom && month === s.vatFrom.slice(0, 7)) {
    notes.push("First return: VAT paid on goods bought in the 4 months before registration and still on hand (6 months for equipment) may be claimed too (s.51(5)). Ask the accountant.");
  }
  return {
    form: "vat",
    period: month,
    title: `VAT return · ${monthName(month)}`,
    practice,
    boxes: [
      { label: "Sales at the standard rate (before tax)", amount: v.output.value },
      { label: "VAT 15% on sales", amount: v.output.vat },
      { label: "NHIL 2.5% on sales", amount: v.output.nhil },
      { label: "GETFund 2.5% on sales", amount: v.output.getfund },
      { label: "Tax on sales (output)", amount: v.output.tax, strong: true },
      { label: "Tax on purchases (input: VAT, NHIL, GETFund)", amount: v.input.tax },
      ...(credit ? [{ label: "Credit from last month", amount: credit }] : []),
      net >= 0 ? { label: "To pay", amount: net, strong: true } : { label: "Credit to carry to next month", amount: -net, strong: true },
    ],
    tables: [
      { title: "Sales: buyer payments received", columns: ["Day", "Buyer", "Receipt", "Paid", "GH₵ with VAT", "Before tax", "Tax"], rows: v.rows.out, empty: "No buyer payments this month." },
      { title: "Purchases with VAT", columns: ["Day", "Supplier", "Entry", "What", "Paid", "Tax in it"], rows: v.rows.inp, empty: "No expenses marked with VAT this month." },
    ],
    notes,
    pay: net > 0 ? { amount: net, to: "GRA" } : null,
  };
}

/** Workers paid through Payday in a month: each worker's pay, added up (the steel machines aren't wages). */
function wagesIn(month: string, inputs: FormInputs): Map<string, { name: string; pay: number; payments: number }> {
  const byWorker = new Map<string, { name: string; pay: number; payments: number }>();
  for (const x of inputs.expenses) {
    if (!isWages(x) || x.machines || !COMPANY.has(x.forWho)) continue;
    // Wages typed in Expenses have no names: one line for all of them.
    if (!x.wages) {
      if (!inMonth(x.date, month)) continue;
      const w = byWorker.get("typed") ?? { name: "Wages typed in Expenses (no names)", pay: 0, payments: 0 };
      w.pay = round2(w.pay + x.amount);
      w.payments += 1;
      byWorker.set("typed", w);
      continue;
    }
    for (const l of x.wages) {
      const day = l.at.slice(0, 10);
      if (!inMonth(day, month)) continue;
      const w = byWorker.get(l.id) ?? { name: l.name, pay: 0, payments: 0 };
      w.pay = round2(w.pay + l.amount);
      w.payments += 1;
      byWorker.set(l.id, w);
    }
  }
  return byWorker;
}
const staffIn = (s: FilingSettings, month: string) => s.staff.filter((x) => x.from <= month && (!x.until || x.until >= month));

export function payeSheet(month: string, inputs: FormInputs, s: FilingSettings): Sheet {
  const practice = !s.payFrom
    ? "Practice only: type the first month the company pays the site itself under Company details."
    : month < s.payFrom
      ? `Practice only: the company pays the site from ${monthName(s.payFrom)}.`
      : null;
  const byWorker = wagesIn(month, inputs);
  const workers = [...byWorker.values()].sort((a, b) => a.name.localeCompare(b.name));
  const named = byWorker.size - (byWorker.has("typed") ? 1 : 0);
  const who = [named ? `${named} ${named === 1 ? "worker" : "workers"}` : "", byWorker.has("typed") ? "wages typed without names" : ""].filter(Boolean).join(" + ") || "none";
  const casualPay = round2(workers.reduce((n, w) => n + w.pay, 0));
  const casualTax = round2(workers.reduce((n, w) => n + round2((w.pay * CASUAL_RATE) / 100), 0));
  const staff = staffIn(s, month).map((x) => {
    const ssnit = x.ssnit ? round2((x.salary * SSNIT_EMPLOYEE) / 100) : 0;
    const chargeable = round2(x.salary - ssnit);
    return { ...x, ssnitEmployee: ssnit, chargeable, paye: payeOn(chargeable, month) };
  });
  const staffTax = round2(staff.reduce((n, x) => n + x.paye, 0));
  const total = round2(casualTax + staffTax);
  return {
    form: "paye",
    period: month,
    title: `PAYE · ${monthName(month)}`,
    practice,
    boxes: [
      { label: `Casual workers' pay (${who})`, amount: casualPay },
      { label: "Tax on it, 5%", amount: casualTax },
      { label: `Salaries (${staff.length})`, amount: round2(staff.reduce((n, x) => n + x.salary, 0)) },
      { label: "PAYE on salaries", amount: staffTax },
      { label: "To pay", amount: total, strong: true },
    ],
    tables: [
      { title: "Casual workers", columns: ["Worker", "Payments", "Pay", "Tax 5%", "Paid out"], rows: workers.map((w) => ({ cells: [w.name, String(w.payments), money2(w.pay), money2(round2((w.pay * CASUAL_RATE) / 100)), money2(round2(w.pay - (w.pay * CASUAL_RATE) / 100))] })), empty: "No wages paid in Payday this month." },
      { title: "Staff on salaries", columns: ["Name", "Salary", "SSNIT 5.5%", "Taxable", "PAYE", "Take-home"], rows: staff.map((x) => ({ cells: [x.name, money2(x.salary), money2(x.ssnitEmployee), money2(x.chargeable), money2(x.paye), money2(round2(x.salary - x.ssnitEmployee - x.paye))] })), empty: "No staff on salaries. Add them under Company details." },
    ],
    notes: [
      "A casual worker is paid by the day for seasonal or on-and-off work, not more than 6 months in a row (Labour Act 2003). Anyone employed longer counts as an employee: ask the accountant which workers that is.",
      "\"Paid out\" is the pay less the 5% kept back. If the company pays the 5% on top instead, the tax is the same.",
      "Salaries use the PAYE bands in force from 1 Sep 2026.",
    ],
    pay: total > 0 ? { amount: total, to: "GRA" } : null,
  };
}

export function ssnitSheet(month: string, inputs: FormInputs, s: FilingSettings): Sheet {
  const practice = !s.payFrom ? "Practice only: type the first month the company pays the site itself under Company details." : month < s.payFrom ? `Practice only: the company pays the site from ${monthName(s.payFrom)}.` : null;
  const staff = staffIn(s, month).filter((x) => x.ssnit);
  const rows = staff.map((x) => {
    const employee = round2((x.salary * SSNIT_EMPLOYEE) / 100);
    const employer = round2((x.salary * SSNIT_EMPLOYER) / 100);
    const tier1 = round2((x.salary * SSNIT_TIER1) / 100);
    return { x, employee, employer, tier1, tier2: round2(employee + employer - tier1) };
  });
  const tier1 = round2(rows.reduce((n, r) => n + r.tier1, 0));
  const tier2 = round2(rows.reduce((n, r) => n + r.tier2, 0));
  const workers = wagesIn(month, inputs).size;
  return {
    form: "ssnit",
    period: month,
    title: `SSNIT · ${monthName(month)}`,
    practice,
    boxes: [
      { label: `Salaries on SSNIT (${rows.length})`, amount: round2(rows.reduce((n, r) => n + r.x.salary, 0)) },
      { label: "Kept back from staff, 5.5%", amount: round2(rows.reduce((n, r) => n + r.employee, 0)) },
      { label: "From the company, 13%", amount: round2(rows.reduce((n, r) => n + r.employer, 0)) },
      { label: "To SSNIT (Tier 1), 13.5%", amount: tier1, strong: true },
      { label: "To the Tier 2 trustee, 5%", amount: tier2, strong: true },
    ],
    tables: [
      { title: "Staff on SSNIT", columns: ["Name", "Salary", "Employee 5.5%", "Company 13%", "Tier 1 13.5%", "Tier 2 5%"], rows: rows.map((r) => ({ cells: [r.x.name, money2(r.x.salary), money2(r.employee), money2(r.employer), money2(r.tier1), money2(r.tier2)] })), empty: "No staff on SSNIT. Add them under Company details." },
    ],
    notes: [
      "Each salary counts as basic salary here. If someone gets allowances on top, give the accountant their basic salary.",
      ...(workers ? [`${workers} daily-paid ${workers === 1 ? "worker was" : "workers were"} paid this month and aren't counted here: ask the accountant whether SSNIT covers them.`] : []),
    ],
    pay: tier1 + tier2 > 0 ? { amount: round2(tier1 + tier2), to: "SSNIT and the Tier 2 trustee" } : null,
  };
}

export function whtSheet(month: string, inputs: FormInputs, s: FilingSettings): Sheet {
  const practice = !s.payFrom ? "Practice only: type the first month the company pays the site itself under Company details." : month < s.payFrom ? `Practice only: the company pays the site from ${monthName(s.payFrom)}.` : null;
  const year = month.slice(0, 4);
  const yearStart = practice || !s.payFrom || s.payFrom.slice(0, 4) !== year ? `${year}-01-01` : `${s.payFrom}-01`;
  // Payments to suppliers: the company's expenses, not wages (PAYE) and not the steel machines' Payday line.
  const paid = inputs.expenses.filter((x) => COMPANY.has(x.forWho) && !isWages(x) && x.date >= yearStart && x.date.slice(0, 7) <= month).sort((a, b) => a.date.localeCompare(b.date));
  const bySupplier = new Map<string, { name: string; before: number; lines: FormExpense[] }>();
  for (const x of paid) {
    const key = supplierKey(x.supplier);
    const e = bySupplier.get(key) ?? { name: x.supplier.trim() || "(no supplier name)", before: 0, lines: [] };
    if (x.date.slice(0, 7) < month) e.before = round2(e.before + x.amount);
    else e.lines.push(x);
    bySupplier.set(key, e);
  }
  const rows: SheetRow[] = [];
  let total = 0;
  let gross = 0;
  for (const [key, e] of [...bySupplier.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
    if (!e.lines.length) continue;
    const set = s.suppliers[key] ?? {};
    const type: WhtType = set.type ?? whtGuess({ category: e.lines[0].category, costClass: e.lines[0].costClass, supplier: e.name, description: e.lines[0].description });
    const month$ = round2(e.lines.reduce((n, x) => n + x.amount, 0));
    const yearToDate = round2(e.before + month$);
    const over = yearToDate > WHT_THRESHOLD;
    // Once over GH₵2,000 in the year, this month's payments all count (the one that crosses it too).
    const tax = type === "none" || !over ? 0 : round2((month$ * WHT_RATE[type]) / 100);
    gross += tax > 0 ? month$ : 0;
    total = round2(total + tax);
    rows.push({
      cells: [e.name, set.tin ?? "", String(e.lines.length), money2(month$), money2(yearToDate), WHT_WORDS[type], money2(tax)],
      action: { kind: "supplier", id: key, label: "Change" },
      muted: tax === 0,
      warn: tax > 0 && !set.tin ? "Type their TIN (it's on their invoice)" : undefined,
    });
  }
  return {
    form: "wht",
    period: month,
    title: `Withholding tax · ${monthName(month)}`,
    practice,
    boxes: [
      { label: "Payments with WHT this month", amount: round2(gross) },
      { label: "WHT to pay", amount: total, strong: true },
    ],
    tables: [{ title: "Suppliers paid this month", columns: ["Supplier", "TIN", "Payments", "This month", "This year", "Kind", "WHT"], rows, empty: "No suppliers paid this month." }],
    notes: [
      "Goods 3%, building work 5%, services 7.5%, once a supplier has been paid over GH₵2,000 in the year. Tap Change to set a supplier's kind and TIN; the guess comes from the expense's category.",
      "Wages aren't here (they're in PAYE), and nor are House or Niko entries.",
      "Payments to companies abroad (Google, Meta, software) aren't on this return: ask the accountant about tax on services bought from abroad.",
      "Log each expense at the full price. If the full price was paid without keeping the tax back, the company still owes the tax.",
    ],
    pay: total > 0 ? { amount: total, to: "GRA" } : null,
  };
}

export function sheetFor(form: FormKind, period: string, inputs: FormInputs, s: FilingSettings): Sheet {
  if (form === "vat") return vatSheet(period, inputs, s);
  if (form === "paye") return payeSheet(period, inputs, s);
  if (form === "ssnit") return ssnitSheet(period, inputs, s);
  return whtSheet(period, inputs, s);
}

/** A sheet as CSV for Excel: the boxes, then each table. */
export function sheetCsv(sheet: Sheet, company: Company | null): string {
  const q = (v: string | number) => {
    const t = String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const lines: string[] = [];
  lines.push(q(sheet.title));
  if (company) lines.push([q(company.name), q(`TIN ${company.tin}`)].join(","));
  if (sheet.practice) lines.push(q(sheet.practice));
  lines.push("");
  for (const b of sheet.boxes) lines.push([q(b.label), b.amount.toFixed(2)].join(","));
  for (const t of sheet.tables) {
    lines.push("", q(t.title), t.columns.map(q).join(","));
    for (const r of t.rows) lines.push(r.cells.map((c) => q(c.replace(/,(?=\d{3})/g, ""))).join(","));
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
