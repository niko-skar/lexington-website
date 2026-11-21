import "server-only";

import { randomBytes } from "node:crypto";

import { notifyOwner } from "@/lib/alerts/notify";
import { listBuyers } from "@/lib/buyers/payments";
import { listExpenses } from "@/lib/expenses/server";
import type { Expense } from "@/lib/expenses/shared";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { FILING_PREFIX, FILINGS_ID } from "@/lib/site/ids";
import { ghanaDay } from "@/lib/store/shared";
import { cleanText, TodoError } from "@/lib/todo/server";
import type { TodoMe } from "@/lib/todo/shared";
import {
  addDays,
  buyerHasVat,
  calendar,
  DAY_RE,
  daysBetween,
  EMPTY_SETTINGS,
  MONTH_RE,
  recordKey,
  RECURRING,
  SETUP,
  setupList,
  sheetFor,
  type Company,
  type DueItem,
  type FilingRecord,
  type FilingSettings,
  type FormBuyer,
  type FormExpense,
  type FormInputs,
  type FormKind,
  type Sheet,
  type Staff,
  type WhtType,
} from "./shared";

// Tax & filings (lib/filings/shared.ts says what and why). The settings are one document holding JSON
// ("filings-live": the company, the dates things start, the staff on salaries, each supplier's WHT kind and TIN,
// buyers' VAT, dollar rates, the one-off tasks done), saved against its revision so two quick saves can't undo each
// other. Each return filed is its own document ("filing-live-vat--2026-12"). The reminders sent are kept apart
// ("filings-live-reminders") so the morning run never clashes with a save on the page.

type Data = Record<string, unknown>;
const REMINDERS_ID = `${FILINGS_ID}-reminders`;
const FORMS: readonly FormKind[] = ["vat", "paye", "wht", "ssnit"];
const WHT_TYPES: readonly WhtType[] = ["goods", "works", "services", "none"];
const PERIOD_RE = /^\d{4}(-(0[1-9]|1[0-2]|Q[1-4]))?$/;
const recordId = (rule: string, period: string) => `${FILING_PREFIX}${rule}--${period}`;

/* ---------- reading ---------- */

const obj = (v: unknown): Data => (v && typeof v === "object" && !Array.isArray(v) ? (v as Data) : {});

/** The settings as stored, every field there and sound. */
export function settingsFrom(raw: unknown): FilingSettings {
  const r = obj(raw);
  const day = (v: unknown) => (typeof v === "string" && DAY_RE.test(v) ? v : null);
  const staff = Array.isArray(r.staff)
    ? (r.staff as Data[])
        .filter((x) => x && typeof x.id === "string" && typeof x.name === "string" && Number(x.salary) > 0 && typeof x.from === "string" && MONTH_RE.test(x.from))
        .map((x) => ({ id: String(x.id), name: String(x.name), salary: Number(x.salary), ssnit: x.ssnit === true, from: String(x.from), until: typeof x.until === "string" && MONTH_RE.test(x.until) ? x.until : null }))
    : [];
  const c = obj(r.company);
  return {
    company: typeof c.name === "string" && c.name ? { name: String(c.name), regNo: String(c.regNo ?? ""), tin: String(c.tin ?? ""), incorporated: day(c.incorporated) ?? "2026-11-17", address: String(c.address ?? ""), auditor: String(c.auditor ?? "") } : null,
    vatFrom: day(r.vatFrom),
    payFrom: typeof r.payFrom === "string" && MONTH_RE.test(r.payFrom) ? r.payFrom : null,
    dpcFrom: day(r.dpcFrom),
    staff,
    suppliers: Object.fromEntries(
      Object.entries(obj(r.suppliers)).map(([k, v]) => {
        const x = obj(v);
        return [k, { ...(WHT_TYPES.includes(x.type as WhtType) ? { type: x.type as WhtType } : {}), ...(typeof x.tin === "string" && x.tin ? { tin: x.tin } : {}) }];
      })
    ),
    vatBuyers: Object.fromEntries(Object.entries(obj(r.vatBuyers)).filter(([, v]) => typeof v === "boolean")) as Record<string, boolean>,
    rates: Object.fromEntries(Object.entries(obj(r.rates)).filter(([, v]) => typeof v === "number" && v > 0)) as Record<string, number>,
    setup: Object.fromEntries(
      Object.entries(obj(r.setup))
        .map(([k, v]) => [k, obj(v)] as const)
        .filter(([k, v]) => SETUP.some((s) => s.id === k) && typeof v.at === "string")
        .map(([k, v]) => [k, { at: String(v.at), by: String(v.by ?? ""), note: typeof v.note === "string" && v.note ? v.note : null }])
    ),
  };
}

async function readSettings(): Promise<{ settings: FilingSettings; rev: string | null }> {
  const doc = await getBuyersClient().fetch<{ json?: string; _rev?: string } | null>(`*[_id == $id][0]{ json, _rev }`, { id: FILINGS_ID });
  let raw: unknown = null;
  try {
    raw = doc?.json ? JSON.parse(doc.json) : null;
  } catch {
    raw = null;
  }
  return { settings: raw ? settingsFrom(raw) : { ...EMPTY_SETTINGS }, rev: doc?._rev ?? null };
}

/** Changes the settings: read, change, save against the revision read (tried again if another save got there first). */
async function changeSettings(change: (s: FilingSettings) => FilingSettings, by: string): Promise<FilingSettings> {
  const client = getBuyersClient();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { settings, rev } = await readSettings();
    const next = change(settings);
    const fields = { json: JSON.stringify(next), updatedAt: new Date().toISOString(), updatedBy: by };
    try {
      if (rev) await client.patch(FILINGS_ID).ifRevisionId(rev).set(fields).commit();
      else await client.create({ _id: FILINGS_ID, _type: "filingSettings", ...fields });
      return next;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status !== 409 && status !== 412) throw error;
    }
  }
  throw new TodoError(409, "Someone else was saving at the same moment. Try again.");
}

async function readRecords(): Promise<Record<string, FilingRecord>> {
  const rows = await getBuyersClient().fetch<FilingRecord[]>(
    `*[_type == "filingRecord" && string::startsWith(_id, $prefix)][0...2000]{ rule, period, status, on, ref, paid, note, by, at }`,
    { prefix: FILING_PREFIX }
  );
  return Object.fromEntries(rows.filter((r) => r.rule && r.period).map((r) => [recordKey(r.rule, r.period), { ...r, ref: r.ref ?? null, paid: r.paid ?? null, note: r.note ?? null }]));
}

const formExpense = (x: Expense): FormExpense => ({
  id: x.id,
  ref: x.ref,
  date: x.date,
  forWho: x.forWho,
  amount: x.amount,
  vat: x.vat === true,
  vatRate: x.vatRate ?? null,
  supplier: x.supplier ?? "",
  description: x.description ?? "",
  category: x.category ?? null,
  costClass: x.costClass?.name ?? null,
  receipt: !!x.receiptId,
  wages: x.payday && x.payday.kind === "workers" ? x.payday.lines.map((l) => ({ id: l.id, name: l.name, amount: l.amount, at: l.at })) : null,
  machines: x.payday?.kind === "machines",
});

/** What the figures are worked out from: the expenses (money out only) and the buyers' payments. */
async function formInputs(): Promise<FormInputs> {
  const [expenses, buyers] = await Promise.all([listExpenses(), listBuyers().catch(() => ({ buyers: [], lastRate: null }))]);
  return {
    expenses: expenses.filter((x) => x.kind !== "inflow").map(formExpense),
    buyers: buyers.buyers.map(
      (b): FormBuyer => ({
        id: b.id,
        name: b.name,
        unit: b.unit,
        payments: b.payments.map((p) => ({ key: p.key, amount: p.amount, currency: p.currency, exchangeRate: p.exchangeRate, date: p.date, method: p.method, receipt: p.receipt })),
      })
    ),
    lastRate: buyers.lastRate ?? null,
  };
}

export interface FilingsPage {
  today: string;
  settings: FilingSettings;
  items: DueItem[];
  /** Buyers, for the VAT sheet's buttons: whether their payments carry the company's VAT. */
  buyers: Array<{ id: string; name: string; unit: string | null; vat: boolean; set: boolean }>;
  lastRate: number | null;
}

/** The figures' amount to pay on each return whose month is over and isn't filed. */
function withAmounts(items: DueItem[], inputs: FormInputs | null, s: FilingSettings, today: string): DueItem[] {
  if (!inputs) return items;
  const month = today.slice(0, 7);
  return items.map((i) => {
    if (!i.form || i.record || i.period >= month || (i.status !== "due" && i.status !== "late")) return i;
    try {
      return { ...i, amount: sheetFor(i.form, i.period, inputs, s).pay?.amount ?? 0 };
    } catch {
      return i;
    }
  });
}

export async function filingsPage(): Promise<FilingsPage> {
  const today = ghanaDay();
  const [{ settings }, records] = await Promise.all([readSettings(), readRecords()]);
  const items = calendar(settings, records, today);
  const needsFigures = items.some((i) => i.form && !i.record && i.period < today.slice(0, 7));
  const inputs = await formInputs();
  return {
    today,
    settings,
    items: withAmounts(items, needsFigures ? inputs : null, settings, today),
    buyers: inputs.buyers.map((b) => ({ id: b.id, name: b.name, unit: b.unit, vat: buyerHasVat(b, settings), set: typeof settings.vatBuyers[b.id] === "boolean" })),
    lastRate: inputs.lastRate,
  };
}

/** One return's figures, for any month (a month before the start shows as practice). */
export async function filingSheet(form: unknown, period: unknown): Promise<{ sheet: Sheet; company: Company | null }> {
  if (!FORMS.includes(form as FormKind)) throw new TodoError(400, "That return isn't known.");
  if (typeof period !== "string" || !MONTH_RE.test(period)) throw new TodoError(400, "Pick a month.");
  const [{ settings }, inputs] = await Promise.all([readSettings(), formInputs()]);
  return { sheet: sheetFor(form as FormKind, period, inputs, settings), company: settings.company };
}

/* ---------- changing ---------- */

function cleanDay(value: unknown, message: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !DAY_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new TodoError(400, message);
  return value;
}
function cleanMonth(value: unknown, message: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !MONTH_RE.test(value)) throw new TodoError(400, message);
  return value;
}
function cleanAmount(value: unknown, message: string, max = 100_000_000): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Math.round(Number(String(value).replace(/[,\s]/g, "")) * 100) / 100;
  if (!Number.isFinite(n) || n < 0 || n > max) throw new TodoError(400, message);
  return n;
}

/**
 *   { action: "company", company: { name, regNo, tin, incorporated, address, auditor } }
 *   { action: "dates", vatFrom?, payFrom?, dpcFrom? }          the day VAT starts, the first month the company pays the site, the DPC day
 *   { action: "setup", id, done, note? }                       a one-off task done (or not)
 *   { action: "filed", rule, period, status, on, ref?, paid?, note? }
 *   { action: "unfiled", rule, period }
 *   { action: "staff", id?, name, salary, ssnit, from, until? } / { action: "staffdelete", id }
 *   { action: "supplier", key, type, tin }                     a supplier's WHT kind (null: the guess) and TIN
 *   { action: "buyer", id, vat }                               this buyer's payments carry the company's VAT (null: the default)
 *   { action: "rate", key, rate }                              GH₵ for one US$ on a dollar payment's day
 */
export async function changeFilings(me: TodoMe, body: Data): Promise<void> {
  const by = me.name;
  const client = getBuyersClient();
  const today = ghanaDay();

  if (body.action === "company") {
    const c = obj(body.company);
    const name = cleanText(c.name, 120, "company name");
    if (!name) throw new TodoError(400, "Type the company's name.");
    const company: Company = {
      name,
      regNo: cleanText(c.regNo, 30, "registration number"),
      tin: cleanText(c.tin, 20, "TIN").toUpperCase(),
      incorporated: cleanDay(c.incorporated, "Pick the day the company was incorporated.") ?? "2026-11-17",
      address: cleanText(c.address, 300, "address"),
      auditor: cleanText(c.auditor, 120, "auditor"),
    };
    await changeSettings((s) => ({ ...s, company }), by);
    return;
  }
  if (body.action === "dates") {
    const vatFrom = cleanDay(body.vatFrom, "Pick the day the company's VAT starts.");
    const payFrom = cleanMonth(body.payFrom, "Pick the first month the company pays the site.");
    const dpcFrom = cleanDay(body.dpcFrom, "Pick the day the company registered with the Data Protection Commission.");
    if (vatFrom && vatFrom < "2026-11-17") throw new TodoError(400, "The company's VAT can't start before the company (17 Nov 2026).");
    if (payFrom && payFrom < "2026-11") throw new TodoError(400, "The company started in November 2026.");
    await changeSettings((s) => ({ ...s, ...(body.vatFrom !== undefined ? { vatFrom } : {}), ...(body.payFrom !== undefined ? { payFrom } : {}), ...(body.dpcFrom !== undefined ? { dpcFrom } : {}) }), by);
    return;
  }
  if (body.action === "setup") {
    const rule = SETUP.find((r) => r.id === body.id);
    if (!rule) throw new TodoError(404, "That task isn't known.");
    const note = cleanText(body.note, 300, "note") || null;
    await changeSettings((s) => {
      const setup = { ...s.setup };
      if (body.done === true) setup[rule.id] = { at: new Date().toISOString(), by, note };
      else delete setup[rule.id];
      // Registering with the Data Protection Commission starts its 2-year clock (unless a day was typed already).
      const dpcFrom = rule.id === "dpc" && body.done === true && !s.dpcFrom ? today : s.dpcFrom;
      return { ...s, setup, dpcFrom };
    }, by);
    return;
  }
  if (body.action === "filed") {
    const rule = RECURRING.find((r) => r.id === body.rule);
    if (!rule) throw new TodoError(404, "That return isn't known.");
    if (typeof body.period !== "string" || !PERIOD_RE.test(body.period)) throw new TodoError(400, "That period isn't known.");
    const status = body.status === "skipped" ? "skipped" : "filed";
    const on = cleanDay(body.on, "Pick the day it was filed.") ?? today;
    if (on > addDays(today, 1)) throw new TodoError(400, "It can't be filed in the future.");
    const record: FilingRecord = {
      rule: rule.id,
      period: body.period,
      status,
      on,
      ref: cleanText(body.ref, 60, "reference") || null,
      paid: cleanAmount(body.paid, "Type the amount paid as a number, e.g. 1250.50."),
      note: cleanText(body.note, 300, "note") || null,
      by,
      at: new Date().toISOString(),
    };
    await client.createOrReplace({ _id: recordId(rule.id, body.period), _type: "filingRecord", ...record });
    return;
  }
  if (body.action === "unfiled") {
    if (typeof body.rule !== "string" || typeof body.period !== "string" || !RECURRING.some((r) => r.id === body.rule) || !PERIOD_RE.test(body.period)) throw new TodoError(404, "That return isn't known.");
    await client.delete(recordId(body.rule, body.period));
    return;
  }
  if (body.action === "staff") {
    const name = cleanText(body.name, 60, "name");
    if (!name) throw new TodoError(400, "Type their name.");
    const salary = cleanAmount(body.salary, "Type the monthly salary as a number, e.g. 3500.", 1_000_000);
    if (!salary) throw new TodoError(400, "Type the monthly salary.");
    const from = cleanMonth(body.from, "Pick the month the salary starts.");
    if (!from) throw new TodoError(400, "Pick the month the salary starts.");
    const until = cleanMonth(body.until, "Pick the last month, or leave it empty.");
    if (until && until < from) throw new TodoError(400, "The last month can't be before the first.");
    const id = typeof body.id === "string" && /^[a-f0-9]{8}$/.test(body.id) ? body.id : randomBytes(4).toString("hex");
    const person: Staff = { id, name, salary, ssnit: body.ssnit !== false, from, until };
    await changeSettings((s) => ({ ...s, staff: [...s.staff.filter((x) => x.id !== id), person].sort((a, b) => a.name.localeCompare(b.name)) }), by);
    return;
  }
  if (body.action === "staffdelete") {
    await changeSettings((s) => ({ ...s, staff: s.staff.filter((x) => x.id !== body.id) }), by);
    return;
  }
  if (body.action === "supplier") {
    const key = cleanText(body.key, 120, "supplier").toLowerCase();
    if (!key) throw new TodoError(400, "That supplier isn't known.");
    const type = body.type === null || body.type === undefined || body.type === "" ? null : WHT_TYPES.includes(body.type as WhtType) ? (body.type as WhtType) : undefined;
    if (type === undefined) throw new TodoError(400, "Pick goods, building work, services or no WHT.");
    const tin = cleanText(body.tin, 20, "TIN").toUpperCase().replace(/\s+/g, "");
    if (tin && !/^[A-Z0-9-]{6,20}$/.test(tin)) throw new TodoError(400, "A TIN is letters and numbers, e.g. C0001234567.");
    await changeSettings((s) => {
      const suppliers = { ...s.suppliers };
      const next = { ...(type ? { type } : {}), ...(tin ? { tin } : {}) };
      if (Object.keys(next).length) suppliers[key] = next;
      else delete suppliers[key];
      return { ...s, suppliers };
    }, by);
    return;
  }
  if (body.action === "buyer") {
    if (typeof body.id !== "string" || !body.id) throw new TodoError(404, "That buyer isn't known.");
    const id = body.id;
    await changeSettings((s) => {
      const vatBuyers = { ...s.vatBuyers };
      if (typeof body.vat === "boolean") vatBuyers[id] = body.vat;
      else delete vatBuyers[id];
      return { ...s, vatBuyers };
    }, by);
    return;
  }
  if (body.action === "rate") {
    if (typeof body.key !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(body.key)) throw new TodoError(404, "That payment isn't known.");
    const key = body.key;
    const rate = cleanAmount(body.rate, "Type the rate as GH₵ for one US$, e.g. 11.65.", 1000);
    if (rate !== null && rate < 0.5) throw new TodoError(400, "Type the rate as GH₵ for one US$, e.g. 11.65.");
    await changeSettings((s) => {
      const rates = { ...s.rates };
      if (rate) rates[key] = rate;
      else delete rates[key];
      return { ...s, rates };
    }, by);
    return;
  }
  throw new TodoError(400, "That button isn't known.");
}

/* ---------- reminders ---------- */

const dayWords = (day: string, today: string) =>
  day === today ? "today" : day === addDays(today, 1) ? "tomorrow" : new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const cedis = (n: number) => `GH₵ ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Which reminder an item gets today, if any. */
export function reminderStage(item: DueItem, today: string): string | null {
  if (item.record) return null;
  const d = item.days;
  if (d < 0) {
    const late = -d;
    return late === 1 || late === 3 || late % 7 === 0 ? `late${late}` : null;
  }
  if (d === 0) return "today";
  if (d === 3) return "soon";
  // Ready: two weeks ahead, once the month it covers is over.
  const monthOver = !item.form || item.period < today.slice(0, 7);
  if (d <= 14 && monthOver) return "ready";
  return null;
}

/**
 * Every morning (vercel.json): a return that's ready, 3 days away, due today or late buzzes the office's phone, once
 * per stage; on Mondays, the company's one-off tasks still open come as one alert.
 */
export async function filingReminders(): Promise<{ sent: number }> {
  const today = ghanaDay();
  const client = getBuyersClient();
  const [{ settings }, records, done] = await Promise.all([
    readSettings(),
    readRecords(),
    client.fetch<string | null>(`*[_id == $id][0].json`, { id: REMINDERS_ID }).then((j) => {
      try {
        return new Set<string>(j ? (JSON.parse(j) as string[]) : []);
      } catch {
        return new Set<string>();
      }
    }),
  ]);
  const items = calendar(settings, records, today, 30, 400);
  const due = items.map((i) => ({ i, stage: reminderStage(i, today) })).filter((x): x is { i: DueItem; stage: string } => !!x.stage && !done.has(`${x.i.key}|${x.stage}`));
  const inputs = due.some((x) => x.i.form) ? await formInputs() : null;
  let sent = 0;
  const marked: string[] = [];
  for (const { i, stage } of due) {
    const amount = inputs && i.form && i.period < today.slice(0, 7) ? (sheetFor(i.form, i.period, inputs, settings).pay?.amount ?? 0) : null;
    const when = i.days < 0 ? `${-i.days} ${i.days === -1 ? "day" : "days"} late` : stage === "today" ? "due today" : `due ${dayWords(i.by, today)}`;
    const ok = await notifyOwner({
      kind: "filing",
      title: stage === "ready" ? `${i.title}: ready to file` : `${i.title}: ${when}`,
      lines: [
        `${i.who} · file${amount !== null ? " and pay" : ""} by ${dayWords(i.by, today)}`,
        ...(amount !== null ? [amount > 0 ? `${cedis(amount)} to pay` : "Nothing to pay: a nil return still has to be filed"] : []),
        ...(i.days < 0 ? ["Penalties and interest grow while it's late."] : []),
      ],
      links: [{ label: "Open Tax & filings", url: `/todo/filings?open=${encodeURIComponent(i.key)}` }],
      urgent: true,
      tag: `filing-${i.key}`,
      open: `/todo/filings?open=${encodeURIComponent(i.key)}`,
    });
    if (ok) {
      sent += 1;
      marked.push(`${i.key}|${stage}`);
    }
  }
  // The company's set-up, on Mondays: what's still to do.
  const open = setupList(settings, today).filter((x) => !x.done);
  const monday = new Date(`${today}T12:00:00Z`).getUTCDay() === 1;
  const weekKey = `setup|${today}`;
  if (monday && open.length && !done.has(weekKey)) {
    const ok = await notifyOwner({
      kind: "filing",
      title: `Company set-up: ${open.length} ${open.length === 1 ? "thing" : "things"} to do`,
      lines: open.slice(0, 4).map((x) => `${x.rule.name}${x.rule.by ? ` (by ${dayWords(x.rule.by, today)})` : ""}`),
      links: [{ label: "Open Tax & filings", url: "/todo/filings" }],
      urgent: open.some((x) => x.days <= 7),
      tag: "filing-setup",
      open: "/todo/filings",
    });
    if (ok) {
      sent += 1;
      marked.push(weekKey);
    }
  }
  if (marked.length) {
    const keep = [...done, ...marked].slice(-600);
    await client.createOrReplace({ _id: REMINDERS_ID, _type: "filingReminders", json: JSON.stringify(keep), updatedAt: new Date().toISOString() });
  }
  return { sent };
}

/** The home page's tile: the next return, how many are late, and the set-up left. */
export async function filingsTile(): Promise<{ next: { title: string; by: string; days: number } | null; late: number; setupLeft: number; setupSoon: number }> {
  const today = ghanaDay();
  const [{ settings }, records] = await Promise.all([readSettings(), readRecords()]);
  const items = calendar(settings, records, today, 120, 400).filter((i) => !i.record);
  const late = items.filter((i) => i.days < 0).length;
  const next = items.find((i) => i.days >= 0) ?? null;
  const open = setupList(settings, today).filter((x) => !x.done);
  return { next: next ? { title: next.title, by: next.by, days: daysBetween(today, next.by) } : null, late, setupLeft: open.length, setupSoon: open.filter((x) => x.days <= 14).length };
}
