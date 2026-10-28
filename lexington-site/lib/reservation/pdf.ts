import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

// The reservation fee form: one A4 page drawn like the payment receipt
// (lib/receipts/pdf.ts): same colours, fonts and layout. It is the form made for
// the first buyer on 9 Oct 2026, now filled in automatically from the website
// flow. If the receipt's look is ever changed, change this to match.
//
// Deliberately NOT on the form:
//  - bank details (14 Oct 2026, Niko: which account to pay into depends on how the
//    buyer wants to pay, so a sales advisor agrees that with them and sends the
//    details separately; the form only says so);
//  - refund, hold-period or "credited to the price" terms (none have been given
//    for reservations);
//  - the seller's signature (it goes on a form only when Niko asks for it).

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
const FOOTER_TOP = 76;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function longDate(iso: string) {
  return `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface ReservationFormData {
  /** As the buyer typed it. */
  buyerName: string;
  /** Printed on the form; leave out when the unit is still to be named. */
  unitNumber?: string;
  /** "One bedroom", or "To be confirmed" when they wanted advice. */
  apartmentFact: string;
  /** "One-bedroom apartment", or "Apartment to be confirmed". */
  apartmentLine: string;
  amountUSD: number;
  /** The fee has VAT in it (VAT on in Site settings): the form says "VAT included". */
  vatIncluded?: boolean;
  /** YYYY-MM-DD */
  issuedOn: string;
  contact: { phone?: string; email?: string; address?: string };
}

export interface ReservationFormOptions {
  /** Print the name as plain text instead of a fill-in field (previews and tests). */
  flat?: boolean;
}

// The built-in fonts only know Western characters. The Akan letters Ɛ ɛ Ɔ ɔ Ŋ ŋ
// are common in Ghanaian names, so they become the nearest letters rather than "?".
const SWAPS: Record<string, string> = { Ɛ: "E", ɛ: "e", Ɔ: "O", ɔ: "o", Ŋ: "Ng", ŋ: "ng", "’": "'", "‘": "'", "“": '"', "”": '"', "–": "-", "—": "-" };

export async function buildReservationFormPdf(
  data: ReservationFormData,
  options: ReservationFormOptions = {}
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Reservation fee form");
  pdf.setAuthor("The Lexington");
  pdf.setSubject(`Reservation fee for ${data.apartmentLine.toLowerCase()}, prepared for ${data.buyerName}`);
  pdf.setCreationDate(new Date());

  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const serifBold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const sansBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const clean = (font: PDFFont, input: string) => {
    const known = new Set(font.getCharacterSet());
    return Array.from(input.replace(/\s+/g, " "))
      .map((ch) => {
        if (known.has(ch.codePointAt(0) as number)) return ch;
        if (ch === "₵") return "GHS ";
        const swap = SWAPS[ch];
        if (swap) return swap;
        // Other accented letters: drop the accent if the base letter is printable.
        const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
        return base && known.has(base.codePointAt(0) as number) ? base : "?";
      })
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

  // A line of text that must stay on one line: shrink it a little, then cut it.
  const fit = (text: string, font: PDFFont, size: number, maxWidth: number, minSize: number) => {
    let s = clean(font, text);
    let px = size;
    while (px > minSize && font.widthOfTextAtSize(s, px) > maxWidth) px -= 0.5;
    if (font.widthOfTextAtSize(s, px) > maxWidth) {
      while (s.length > 1 && font.widthOfTextAtSize(`${s}...`, px) > maxWidth) s = s.slice(0, -1);
      s = `${s}...`;
    }
    return { text: s, size: px };
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

  // ---- header band (as on the receipt) ----
  page.drawRectangle({ x: 0, y: PAGE_H - 120, width: PAGE_W, height: 120, color: NAVY });
  draw("The Lexington", MARGIN, PAGE_H - 64, serifBold, 28, PAPER);
  draw("A SKARLATOS & SON DEVELOPMENT", MARGIN, PAGE_H - 86, sansBold, 7.5, BRASS_LT);
  draw("RESERVATION FEE FORM", PAGE_W - MARGIN, PAGE_H - 58, sansBold, 9, BRASS_LT, "right");
  draw(`USD ${money(data.amountUSD).replace(/\.00$/, "")}`, PAGE_W - MARGIN, PAGE_H - 84, serifBold, 20, PAPER, "right");
  if (data.vatIncluded) draw("VAT INCLUDED", PAGE_W - MARGIN, PAGE_H - 101, sansBold, 7.5, BRASS_LT, "right");

  // ---- form facts ----
  let y = PAGE_H - 150;
  const facts: Array<[string, string]> = [
    ["Date issued", longDate(data.issuedOn)],
    ["Apartment", data.apartmentFact],
    ["Payment", "Agreed with you first"],
  ];
  facts.forEach(([name, value], i) => {
    const x = MARGIN + i * (CONTENT_W / 3);
    label(name, x, y);
    const f = fit(value, sans, 11, CONTENT_W / 3 - 10, 8);
    draw(f.text, x, y - 17, sans, f.size);
  });
  y -= 36;
  rule(y);

  // ---- reservation for ----
  y -= 28;
  label("Reservation for", MARGIN, y);
  const who = fit(data.buyerName, serifBold, 22, CONTENT_W, 13);
  draw(who.text, MARGIN, y - 28, serifBold, who.size);
  draw([data.apartmentLine, "The Lexington, Shiashie, East Legon, Accra"].join("  ·  "), MARGIN, y - 47, sans, 10, GREY);

  // ---- amount ----
  y -= 64;
  const amountH = 82;
  page.drawRectangle({ x: MARGIN, y: y - amountH, width: CONTENT_W, height: amountH, color: PAPER_DIM, borderColor: STONE, borderWidth: 0.6 });
  label("Reservation fee", MARGIN + 22, y - 24);
  const amount = `USD ${money(data.amountUSD)}`;
  draw(amount, MARGIN + 22, y - 54, serifBold, 34);
  if (data.vatIncluded) draw("VAT included", MARGIN + 22 + serifBold.widthOfTextAtSize(amount, 34) + 12, y - 54, sans, 12, GREY);
  const secures = fit("This fee secures your residence at The Lexington. Your sales advisor agrees with you how to pay it.", sans, 9.5, CONTENT_W - 44, 8);
  draw(secures.text, MARGIN + 22, y - 72, sans, secures.size, GREY);

  // ---- your details ----
  y -= amountH + 30;
  const form = pdf.getForm();
  const fieldX = MARGIN + 170;
  const fieldW = 220;

  label("Unit number", MARGIN, y);
  page.drawLine({ start: { x: fieldX, y: y - 4 }, end: { x: fieldX + fieldW, y: y - 4 }, thickness: 0.6, color: STONE });
  draw(data.unitNumber || "To be confirmed in writing", fieldX + 2, y, sans, 11, data.unitNumber ? INK : GREY);
  y -= 28;

  label("Buyer's full name", MARGIN, y);
  page.drawLine({ start: { x: fieldX, y: y - 4 }, end: { x: fieldX + fieldW, y: y - 4 }, thickness: 0.6, color: STONE });
  if (options.flat) {
    draw(data.buyerName, fieldX + 2, y, sans, 11);
  } else {
    // Filled in with what they typed, but still editable: the name here should be the one on the contract.
    const f = form.createTextField("fullName");
    f.setText(clean(sans, data.buyerName));
    f.addToPage(page, { x: fieldX, y: y - 2, width: fieldW, height: 16, borderWidth: 0, textColor: INK, font: sans });
    // A very long name gets a smaller type size so it still shows in full.
    f.setFontSize(fit(data.buyerName, sans, 11, fieldW - 8, 6.5).size);
  }
  draw("as on your contract", fieldX + fieldW + 12, y, sans, 8.5, GREY);
  y -= 29;
  rule(y);

  // ---- how to pay ----
  // No bank details on the form: which account to pay into depends on how the buyer
  // wants to pay, so a sales advisor agrees that with them first and sends the details.
  y -= 24;
  label("How to pay", MARGIN, y);
  const phoneLine = data.contact.phone
    ? `Phone us on ${data.contact.phone} to confirm the bank details before you send any money.`
    : "Please confirm the bank details with us before you send any money.";
  const proofLine = data.contact.email ? ` Then email your proof of payment to ${data.contact.email}.` : " Then send us your proof of payment.";
  const steps: Array<[string, string]> = [
    ["Next step", "Your sales advisor will contact you to agree how you would like to pay. They will then send you the bank details that match."],
    ["Before you pay", phoneLine + proofLine],
  ];
  const valueX = MARGIN + 170;
  const valueW = CONTENT_W - 170 - 18;
  const LINE = 14;
  const wrapped = steps.map(([, text]) => wrap(text, sans, 10.5, valueW));
  let lastBaseline = 24; // distance from the top of the box to the last line of text
  wrapped.forEach((lines, i) => {
    lastBaseline += (lines.length - 1) * LINE + (i < wrapped.length - 1 ? LINE + 10 : 0);
  });
  const boxTop = y - 12;
  const boxH = lastBaseline + 16;
  page.drawRectangle({ x: MARGIN, y: boxTop - boxH, width: CONTENT_W, height: boxH, color: PAPER, borderColor: STONE, borderWidth: 0.6 });
  let ry = boxTop - 24;
  steps.forEach(([name], i) => {
    label(name, MARGIN + 18, ry);
    wrapped[i].forEach((line, j) => draw(line, valueX, ry - 1 - j * LINE, sans, 10.5, INK));
    ry -= wrapped[i].length * LINE + 10;
  });
  y = boxTop - boxH - 24;

  // ---- agreement and signatures ----
  const agree = wrap(
    `I would like to reserve the apartment described above at The Lexington and will pay the reservation fee of USD ${money(data.amountUSD)}${data.vatIncluded ? " (VAT included)" : ""} using the bank details my sales advisor sends me. I understand that the unit number will be confirmed in writing, and that the full terms of my purchase will be set out in the Sale and Purchase Agreement.`,
    sans, 8.5, CONTENT_W
  );
  agree.forEach((line, i) => draw(line, MARGIN, y - i * 12, sans, 8.5, INK));
  y -= agree.length * 12;
  // Room to sign is 48pt, squeezed (never below 30pt) if the page is ever short of space.
  y -= Math.max(30, Math.min(48, y - (FOOTER_TOP + 21)));
  const sigW = (CONTENT_W - 30) / 2;
  const leftX = MARGIN;
  const rightX = MARGIN + sigW + 30;
  page.drawLine({ start: { x: leftX, y }, end: { x: leftX + sigW, y }, thickness: 0.6, color: INK });
  draw("Buyer's signature and date", leftX, y - 11, sans, 7.5, GREY);
  page.drawLine({ start: { x: rightX, y }, end: { x: rightX + sigW, y }, thickness: 0.6, color: INK });
  draw("For The Lexington: name, signature and date", rightX, y - 11, sans, 7.5, GREY);

  // ---- footer (as on the receipt) ----
  page.drawLine({ start: { x: MARGIN, y: FOOTER_TOP }, end: { x: PAGE_W - MARGIN, y: FOOTER_TOP }, thickness: 0.6, color: BRASS });
  const statement = wrap(
    "This form asks for a reservation fee. It is not a receipt: a payment receipt follows once your payment has been received.",
    sans, 8.5, CONTENT_W
  );
  statement.forEach((line, i) => draw(line, MARGIN, FOOTER_TOP - 19 - i * 12, sans, 8.5, GREY));
  const contact = [data.contact.phone, data.contact.email, data.contact.address].filter(Boolean).join("   ·   ");
  if (contact) {
    wrap(contact, sansBold, 8.5, CONTENT_W).forEach((line, i) =>
      draw(line, MARGIN, FOOTER_TOP - 19 - statement.length * 12 - 6 - i * 12, sansBold, 8.5, NAVY)
    );
  }
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: 14, color: NAVY });

  if (y - 11 < FOOTER_TOP + 10) {
    console.warn(`Reservation form: the signature lines run into the footer by ${(FOOTER_TOP + 10 - (y - 11)).toFixed(1)}pt.`);
  }

  if (!options.flat) form.updateFieldAppearances(sans);
  return pdf.save();
}
