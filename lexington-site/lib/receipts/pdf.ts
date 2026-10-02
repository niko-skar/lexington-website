import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

// Same colours as the site.
const NAVY = rgb(62 / 255, 89 / 255, 108 / 255);
const PAPER = rgb(247 / 255, 244 / 255, 236 / 255);
const PAPER_DIM = rgb(237 / 255, 231 / 255, 216 / 255);
const STONE = rgb(201 / 255, 194 / 255, 178 / 255);
const BRASS = rgb(176 / 255, 141 / 255, 87 / 255);
const BRASS_LT = rgb(217 / 255, 194 / 255, 154 / 255);
const INK = rgb(21 / 255, 24 / 255, 26 / 255);
const SAGE = rgb(103 / 255, 115 / 255, 95 / 255);
const GREY = rgb(0.38, 0.38, 0.38);

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function longDate(iso?: string) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "Not recorded";
  const month = MONTHS[Number(iso.slice(5, 7)) - 1];
  return `${Number(iso.slice(8, 10))} ${month} ${iso.slice(0, 4)}`;
}

const money = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface ReceiptData {
  receiptNumber: string;
  issuedOn: string;
  buyerName: string;
  unitNumber: string;
  unitDescription?: string;
  payment: {
    amount: number;
    currency: "GHS" | "USD";
    exchangeRate?: number;
    date?: string;
    methodLabel: string;
    note?: string;
  };
  /** The payment in US dollars, when it can be worked out. */
  usdEquivalent: number | null;
  /** Where the account stands once this payment is counted; null if a Cedi payment has no rate. */
  account: { contractPriceUSD: number; paidToDateUSD: number; balanceUSD: number } | null;
  contact: { phone?: string; email?: string; address?: string };
}

export async function buildReceiptPdf(data: ReceiptData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Payment receipt ${data.receiptNumber}`);
  pdf.setAuthor("The Lexington");
  pdf.setSubject(`Receipt for a payment towards Unit ${data.unitNumber}`);
  pdf.setCreationDate(new Date());

  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const serifBold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const sansBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // The built-in fonts only know Western characters; anything else (and the
  // cedi sign) is swapped for something printable instead of failing.
  const clean = (font: PDFFont, text: string) => {
    const known = new Set(font.getCharacterSet());
    return Array.from(text.replace(/\s+/g, " "))
      .map((ch) => (known.has(ch.codePointAt(0) as number) ? ch : ch === "₵" ? "GHS " : "?"))
      .join("");
  };

  const draw = (
    text: string,
    x: number,
    y: number,
    font: PDFFont,
    size: number,
    color = INK,
    align: "left" | "right" = "left"
  ) => {
    const safe = clean(font, text);
    const left = align === "right" ? x - font.widthOfTextAtSize(safe, size) : x;
    page.drawText(safe, { x: left, y, size, font, color });
  };

  const wrap = (text: string, font: PDFFont, size: number, maxWidth: number) => {
    const words = clean(font, text).split(" ");
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    return lines;
  };

  const rule = (y: number) =>
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.6, color: STONE });

  const label = (text: string, x: number, y: number) => draw(text.toUpperCase(), x, y, sansBold, 7.5, SAGE);

  // ---- header band ----
  page.drawRectangle({ x: 0, y: PAGE_H - 120, width: PAGE_W, height: 120, color: NAVY });
  draw("The Lexington", MARGIN, PAGE_H - 64, serifBold, 28, PAPER);
  draw("A SKARLATOS & SON DEVELOPMENT", MARGIN, PAGE_H - 86, sansBold, 7.5, BRASS_LT);
  draw("PAYMENT RECEIPT", PAGE_W - MARGIN, PAGE_H - 58, sansBold, 9, BRASS_LT, "right");
  draw(data.receiptNumber, PAGE_W - MARGIN, PAGE_H - 84, serifBold, 20, PAPER, "right");

  // ---- receipt facts ----
  let y = PAGE_H - 168;
  const facts: [string, string][] = [
    ["Receipt number", data.receiptNumber],
    ["Date received", longDate(data.payment.date)],
    ["Date issued", longDate(data.issuedOn)],
  ];
  facts.forEach(([name, value], i) => {
    const x = MARGIN + i * (CONTENT_W / 3);
    label(name, x, y);
    draw(value, x, y - 17, sans, 11);
  });

  y -= 44;
  rule(y);

  // ---- received from ----
  y -= 34;
  label("Received from", MARGIN, y);
  draw(data.buyerName, MARGIN, y - 28, serifBold, 22);
  const unitLine = [`Unit ${data.unitNumber}`, data.unitDescription, "The Lexington, Shiashie, East Legon, Accra"]
    .filter(Boolean)
    .join("  ·  ");
  draw(unitLine, MARGIN, y - 48, sans, 10, GREY);

  // ---- amount ----
  y -= 78;
  const amountH = 104;
  page.drawRectangle({
    x: MARGIN,
    y: y - amountH,
    width: CONTENT_W,
    height: amountH,
    color: PAPER_DIM,
    borderColor: STONE,
    borderWidth: 0.6,
  });
  label("Amount received", MARGIN + 22, y - 26);
  const isGhs = data.payment.currency === "GHS";
  draw(`${isGhs ? "GHS" : "USD"} ${money(data.payment.amount)}`, MARGIN + 22, y - 62, serifBold, 34);
  const amountNote = isGhs
    ? data.payment.exchangeRate && data.usdEquivalent !== null
      ? `Exchange rate GHS ${money(data.payment.exchangeRate)} per US dollar   ·   equal to USD ${money(data.usdEquivalent)}`
      : "Exchange rate not recorded"
    : "Paid in US dollars";
  draw(amountNote, MARGIN + 22, y - 86, sans, 9.5, GREY);

  // ---- payment details ----
  y -= amountH + 36;
  const rows: [string, string][] = [
    ["Payment method", data.payment.methodLabel],
    ["Payment date", longDate(data.payment.date)],
    ["Received towards", `Purchase of Unit ${data.unitNumber}, The Lexington`],
  ];
  if (data.payment.note?.trim()) rows.push(["Note", data.payment.note.trim().slice(0, 160)]);
  for (const [name, value] of rows) {
    label(name, MARGIN, y);
    const lines = wrap(value, sans, 11, CONTENT_W - 170);
    lines.forEach((line, i) => draw(line, MARGIN + 170, y - i * 14, sans, 11));
    y -= 14 * Math.max(lines.length, 1) + 14;
  }

  // ---- account position ----
  if (data.account) {
    y -= 8;
    rule(y);
    y -= 30;
    label("Your account after this payment (US dollars)", MARGIN, y);
    const cols: [string, number][] = [
      ["Contract price", data.account.contractPriceUSD],
      ["Paid to date", data.account.paidToDateUSD],
      ["Balance remaining", data.account.balanceUSD],
    ];
    cols.forEach(([name, value], i) => {
      const x = MARGIN + i * (CONTENT_W / 3);
      draw(name, x, y - 22, sans, 9, GREY);
      draw(`USD ${money(value)}`, x, y - 42, serifBold, 16);
    });
    draw(
      "Paid to date counts every payment up to and including this one, with Cedi payments converted at the rate recorded for each.",
      MARGIN,
      y - 64,
      sans,
      8,
      GREY
    );
    y -= 64;
  }

  // ---- footer ----
  const footerTop = 118;
  page.drawLine({
    start: { x: MARGIN, y: footerTop },
    end: { x: PAGE_W - MARGIN, y: footerTop },
    thickness: 0.6,
    color: BRASS,
  });
  const statement = wrap(
    `This receipt confirms that the payment above was received towards the purchase of Unit ${data.unitNumber} at The Lexington. It was issued electronically from the payment record on the buyer's account and is valid without a signature.`,
    sans,
    8.5,
    CONTENT_W
  );
  statement.forEach((line, i) => draw(line, MARGIN, footerTop - 22 - i * 12, sans, 8.5, GREY));
  const contact = [data.contact.phone, data.contact.email, data.contact.address].filter(Boolean).join("   ·   ");
  if (contact) {
    wrap(contact, sansBold, 8.5, CONTENT_W).forEach((line, i) =>
      draw(line, MARGIN, footerTop - 22 - statement.length * 12 - 8 - i * 12, sansBold, 8.5, NAVY)
    );
  }
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: 14, color: NAVY });

  return pdf.save();
}
