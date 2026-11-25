import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { formatUSD } from "@/lib/format";

import { longDate, type PriceListData } from "./data";

// The price list as an A4 PDF, drawn like the reservation form and the receipt (lib/reservation/pdf.ts): the navy band,
// the brass labels, the paper boxes. One or two pages: the homes still for sale by kind, then the finishes, parking and
// storage, how to pay and the next steps. Every page ends with the contact line and the page number.

const NAVY = rgb(62 / 255, 89 / 255, 108 / 255);
const PAPER = rgb(247 / 255, 244 / 255, 236 / 255);
const PAPER_DIM = rgb(237 / 255, 231 / 255, 216 / 255);
const STONE = rgb(201 / 255, 194 / 255, 178 / 255);
const BRASS = rgb(176 / 255, 141 / 255, 87 / 255);
const BRASS_LT = rgb(217 / 255, 194 / 255, 154 / 255);
const BRASS_TEXT = rgb(118 / 255, 89 / 255, 42 / 255);
const CLAY = rgb(139 / 255, 74 / 255, 52 / 255);
const INK = rgb(21 / 255, 24 / 255, 26 / 255);
const GREY = rgb(0.38, 0.38, 0.38);

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_TOP = 70;

// The built-in fonts know Western characters only (see lib/reservation/pdf.ts).
const SWAPS: Record<string, string> = { Ɛ: "E", ɛ: "e", Ɔ: "O", ɔ: "o", Ŋ: "Ng", ŋ: "ng", "’": "'", "‘": "'", "“": '"', "”": '"', "⚡": "" };

export async function buildPriceListPdf(data: PriceListData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`The Lexington price list, ${longDate(data.issuedOn)}`);
  pdf.setAuthor("The Lexington");
  pdf.setSubject("Homes for sale at The Lexington, Shiashie, East Legon, Accra: prices and availability");
  pdf.setCreationDate(new Date());

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
        if (swap !== undefined) return swap;
        const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
        return base && known.has(base.codePointAt(0) as number) ? base : "?";
      })
      .join("")
      .trim();
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
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const draw = (text: string, x: number, at: number, font: PDFFont, size: number, color = INK, align: "left" | "right" = "left") => {
    const safe = clean(font, text);
    page.drawText(safe, { x: align === "right" ? x - font.widthOfTextAtSize(safe, size) : x, y: at, size, font, color });
  };
  const label = (text: string, x: number, at: number, color = BRASS_TEXT) => draw(text.toUpperCase(), x, at, sansBold, 7.5, color);
  const rule = (at: number, color = STONE) => page.drawLine({ start: { x: MARGIN, y: at }, end: { x: PAGE_W - MARGIN, y: at }, thickness: 0.6, color });

  const firstPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    page.drawRectangle({ x: 0, y: PAGE_H - 120, width: PAGE_W, height: 120, color: NAVY });
    draw("The Lexington", MARGIN, PAGE_H - 64, serifBold, 28, PAPER);
    draw("AN OLYMPIAN DEVELOPMENT", MARGIN, PAGE_H - 86, sansBold, 7.5, BRASS_LT);
    draw("PRICE LIST", PAGE_W - MARGIN, PAGE_H - 58, sansBold, 9, BRASS_LT, "right");
    draw(longDate(data.issuedOn), PAGE_W - MARGIN, PAGE_H - 82, serifBold, 17, PAPER, "right");
    draw("SHIASHIE, EAST LEGON, ACCRA", PAGE_W - MARGIN, PAGE_H - 100, sansBold, 7.5, BRASS_LT, "right");
    y = PAGE_H - 148;
  };
  const nextPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    page.drawRectangle({ x: 0, y: PAGE_H - 44, width: PAGE_W, height: 44, color: NAVY });
    draw("The Lexington", MARGIN, PAGE_H - 28, serifBold, 15, PAPER);
    draw(`PRICE LIST · ${longDate(data.issuedOn).toUpperCase()}`, PAGE_W - MARGIN, PAGE_H - 26, sansBold, 7.5, BRASS_LT, "right");
    y = PAGE_H - 74;
  };
  /** Room for `h` points on this page, else a new page. */
  const need = (h: number) => {
    if (y - h < FOOTER_TOP + 14) nextPage();
  };

  firstPage();

  // ---- what this is ----
  const intro = `Homes for sale at The Lexington, eight storeys in Shiashie, East Legon. Prices are in US dollars${data.vatOn ? ", VAT included" : ""}, with the Standard finish. ${data.available} of ${data.total} homes are still available.`;
  for (const line of wrap(intro, sans, 10, CONTENT_W)) {
    draw(line, MARGIN, y, sans, 10, GREY);
    y -= 14;
  }
  y -= 8;

  // ---- the offer running today ----
  if (data.offer) {
    const detail = wrap(data.offer.detail, sans, 10, CONTENT_W - 36);
    const next = data.offer.next ? wrap(data.offer.next, sans, 9, CONTENT_W - 36) : [];
    const h = 30 + detail.length * 13 + (next.length ? 6 + next.length * 12 : 0) + 12;
    page.drawRectangle({ x: MARGIN, y: y - h, width: CONTENT_W, height: h, color: CLAY });
    let oy = y - 24;
    draw(data.offer.headline, MARGIN + 18, oy, serifBold, 15, PAPER);
    oy -= 17;
    for (const line of detail) {
      draw(line, MARGIN + 18, oy, sans, 10, PAPER);
      oy -= 13;
    }
    if (next.length) {
      oy -= 4;
      for (const line of next) {
        draw(line, MARGIN + 18, oy, sans, 9, BRASS_LT);
        oy -= 12;
      }
    }
    y -= h + 20;
  }

  // ---- the kinds at a glance ----
  const kinds = data.kinds;
  if (kinds.length) {
    const gap = 8;
    const w = (CONTENT_W - gap * (kinds.length - 1)) / kinds.length;
    const h = 54;
    kinds.forEach((k, i) => {
      const x = MARGIN + i * (w + gap);
      page.drawRectangle({ x, y: y - h, width: w, height: h, color: PAPER_DIM, borderColor: STONE, borderWidth: 0.6 });
      // A long name ("Duplex penthouses") gets a slightly smaller size so it stays inside its box.
      let nameSize = 10.5;
      while (nameSize > 8 && serifBold.widthOfTextAtSize(clean(serifBold, k.label), nameSize) > w - 16) nameSize -= 0.25;
      draw(k.label, x + 9, y - 17, serifBold, nameSize, INK);
      draw(k.from !== null ? `from ${formatUSD(k.from)}` : "All taken", x + 9, y - 32, sansBold, 9, k.from !== null ? INK : GREY);
      draw(`${k.available} available`.toUpperCase(), x + 9, y - 46, sansBold, 6.5, BRASS_TEXT);
    });
    y -= h + 24;
  }

  // ---- the homes ----
  const COL = { home: MARGIN + 10, floor: MARGIN + 92, size: MARGIN + 150, price: MARGIN + 372, note: MARGIN + 388 };
  const ROW = 17;
  const header = () => {
    label("Home", COL.home, y);
    label("Floor", COL.floor, y);
    label("Size", COL.size, y);
    draw(`Price${data.vatOn ? " incl. VAT" : ""}`.toUpperCase(), COL.price, y, sansBold, 7.5, BRASS_TEXT, "right");
    y -= 8;
    rule(y, BRASS);
    y -= 14;
  };
  need(60);
  header();
  for (const k of kinds) {
    if (!k.homes.length) continue;
    need(ROW * 2 + 12);
    page.drawRectangle({ x: MARGIN, y: y - 6, width: CONTENT_W, height: 18, color: PAPER_DIM });
    draw(k.label, COL.home, y, serifBold, 11, INK);
    draw(`${k.available} available`, PAGE_W - MARGIN - 8, y, sans, 8.5, GREY, "right");
    y -= ROW + 2;
    for (const h of k.homes) {
      if (y - ROW < FOOTER_TOP + 14) {
        nextPage();
        header();
      }
      draw(h.unitNumber, COL.home, y, sansBold, 9.5, INK);
      draw(h.floor, COL.floor, y, sans, 9.5, INK);
      draw(h.size, COL.size, y, sans, 9.5, INK);
      draw(formatUSD(h.price), COL.price, y, serifBold, 10.5, INK, "right");
      if (h.note) draw(h.note, COL.note, y, sans, 8, CLAY);
      y -= 5;
      page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.3, color: STONE });
      y -= ROW - 5;
    }
    y -= 6;
  }

  // ---- finishes, parking and storage, paying, next steps ----
  const section = (title: string, lines: string[], bullet = true) => {
    const size = 9.5;
    const wrapped = lines.map((l) => wrap(l, sans, size, CONTENT_W - 12));
    const h = 20 + wrapped.reduce((n, w) => n + w.length * 13 + 3, 0);
    need(h + 10);
    y -= 10;
    label(title, MARGIN, y);
    y -= 16;
    for (const w of wrapped) {
      w.forEach((line, i) => {
        if (bullet && i === 0) page.drawCircle({ x: MARGIN + 3, y: y + 3, size: 1.4, color: BRASS });
        draw(line, MARGIN + (bullet ? 12 : 0), y, sans, size, INK);
        y -= 13;
      });
      y -= 3;
    }
  };
  if (data.finishes.length) {
    section(
      "Finishes",
      data.finishes.map((f) => `${f.name}: ${f.line}`).concat(["The duplex penthouses come with the Premium finish."].filter(() => kinds.some((k) => k.homes.some((h) => h.note))))
    );
  }
  if (data.extras.length) section("Parking and storage", data.extras);
  section("Paying", data.paying);
  section(
    "Next steps",
    [
      `See every home, with its 3D floor plan: ${data.links.residences.replace(/^https:\/\/www\./, "")}`,
      `Book a site visit, or a video tour on WhatsApp: ${data.links.visit.replace(/^https:\/\/www\./, "")}`,
      `Reserve a home: ${data.links.reserve.replace(/^https:\/\/www\./, "")}`,
      data.contact.phone ? `Call or WhatsApp us: ${data.contact.phone}` : "",
    ].filter(Boolean)
  );

  // ---- footers ----
  const contact = [data.contact.phone, data.contact.email, data.contact.address].filter(Boolean).join("   ·   ");
  pages.forEach((p, i) => {
    page = p;
    page.drawLine({ start: { x: MARGIN, y: FOOTER_TOP }, end: { x: PAGE_W - MARGIN, y: FOOTER_TOP }, thickness: 0.6, color: BRASS });
    const note = wrap(
      "Prices and availability change as homes are reserved: the website always shows the latest. All prices are subject to change without notice. Images and 3D models are illustrative.",
      sans,
      7.5,
      CONTENT_W - 60
    );
    note.forEach((line, j) => draw(line, MARGIN, FOOTER_TOP - 15 - j * 10, sans, 7.5, GREY));
    draw(`${i + 1} / ${pages.length}`, PAGE_W - MARGIN, FOOTER_TOP - 15, sansBold, 7.5, GREY, "right");
    if (contact) wrap(contact, sansBold, 8, CONTENT_W).forEach((line, j) => draw(line, MARGIN, FOOTER_TOP - 22 - note.length * 10 - j * 11, sansBold, 8, NAVY));
    page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: 12, color: NAVY });
  });

  return pdf.save();
}
