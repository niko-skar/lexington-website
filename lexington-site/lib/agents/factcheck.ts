/**
 * The fact check every written reply and post goes through before anyone sees it.
 *
 * It does not judge the writing; it holds every checkable claim against the fact
 * pack: each dollar amount, percentage, size and unit number must be one the
 * website itself shows, each link must go to a real page of the website, and a
 * short list of claims the website never makes (a rooftop pool, rental returns,
 * bank details, the developer's company name...) is looked for. Anything it finds
 * is shown to Niko as "check before sending", and a reply with anything found is
 * never sent automatically.
 *
 * Pure, so it can be tested on its own.
 */
import { ESTIMATED_COMPLETION, SITE_URL } from "@/lib/seo";

import { allowedAmounts, allowedAreas, allowedPercents, type FactPack } from "./factsCore";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const SITE_PATHS = ["", "/", "/residences", "/reserve", "/gallery", "/amenities", "/progress", "/contact", "/about"];

/** Claims the website never makes, with what to tell Niko when one turns up. */
const CLAIMS: Array<[RegExp, string]> = [
  [
    /roof\s?-?top\s+(?:swimming\s+)?pool|pool\s+(?:is\s+)?on\s+the\s+roof|roof\s?-?top\s+(?:gym|sauna|jacuzzi|caf[eé]|bar|lounge|terrace)/i,
    "Puts something on the roof that isn't there: the only rooftop amenity is the Private Resident's Rooftop Garden.",
  ],
  [/guarantee/i, "Promises a guarantee."],
  [
    /\byields?\b|return on (?:your )?investment|\bROI\b|rental income|capital (?:gain|growth)|appreciat(?:e|ion)/i,
    "Talks about rental income, returns or value growth: the website makes no such claims.",
  ],
  [
    /bank\s+details|account\s+(?:number|no\.?)|\bIBAN\b|\bSWIFT\b|sort\s+code|routing\s+number/i,
    "Mentions bank details: only the sales team sends those, by hand.",
  ],
  [/skarlatos|olympian/i, "Names the developer company."],
  [/free\s+parking|parking\s+(?:is\s+)?free/i, "Calls parking free (compound parking comes with 1BR and larger; covered parking is $5,000 a space)."],
  [/\b(?:fully\s+)?furnished\b/i, "Says the home comes furnished: the website doesn't say so."],
  [/pre-?approv|mortgage\s+(?:is\s+)?(?:approved|guaranteed)/i, "Promises a mortgage approval."],
  [/\b(?:only|just)\s+\d+\s+(?:units?|homes?|apartments?)\s+(?:left|remaining)\b/i, "Counts the units left: check the number against the unit list."],
];

const norm = (unitNumber: string) => unitNumber.toLowerCase().replace(/\s+/g, "");

/** Every dollar amount written in `text`, with how it was written. */
function dollarAmounts(text: string): Array<{ raw: string; value: number }> {
  const out: Array<{ raw: string; value: number }> = [];
  for (const m of text.matchAll(/(?:US)?\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(\s?k\b|\s?(?:million|m)\b)?/gi)) {
    let value = Number(m[1].replace(/,/g, ""));
    if (m[2]) value *= /k/i.test(m[2]) ? 1000 : 1_000_000;
    out.push({ raw: m[0], value });
  }
  for (const m of text.matchAll(/\b(?:USD|US\s+dollars?)\s?(\d{1,3}(?:,\d{3})+|\d+)/gi)) {
    out.push({ raw: m[0], value: Number(m[1].replace(/,/g, "")) });
  }
  return out;
}

/**
 * What in `text` the website does not back up, in plain words. Empty when everything checks out.
 * `theirWords` is what the person themselves wrote or answered: repeating their own budget back
 * to them ("your budget of $70,000 to $150,000") is not a claim about the building.
 */
export function factCheck(text: string, pack: FactPack, theirWords = ""): string[] {
  const found: string[] = [];
  const flag = (message: string) => {
    if (!found.includes(message)) found.push(message);
  };

  // ---- dollar amounts: "$92,400", "$92400", "$92.4k", "USD 92,400"
  const amounts = allowedAmounts(pack);
  for (const own of dollarAmounts(theirWords)) amounts.add(Math.round(own.value));
  for (const { raw, value } of dollarAmounts(text)) {
    if (!amounts.has(Math.round(value))) flag(`"${raw.trim()}" is not a price, fee or rate the website shows.`);
  }

  // ---- percentages
  const pcts = allowedPercents(pack);
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s?(?:%|per\s?cent\b|percent\b)/gi)) {
    if (!pcts.has(Number(m[1]))) flag(`"${m[0].trim()}" is not a percentage the website shows.`);
  }

  // ---- sizes
  const areas = allowedAreas(pack);
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s?(?:m²|m2\b|sqm\b|sq\.?\s?m\b|square\s+met(?:re|er)s?)/gi)) {
    if (!areas.sqm.has(Number(m[1]))) flag(`"${m[0].trim()}" is not a size the website shows.`);
  }
  for (const m of text.matchAll(/(\d{1,3}(?:,\d{3})+|\d+)\s?(?:sq\.?\s?ft\b|square\s+f(?:ee|oo)t)/gi)) {
    const value = Number(m[1].replace(/,/g, ""));
    // Square feet are worked out from square metres; one either way is rounding.
    if (![...areas.sqft].some((s) => Math.abs(s - value) <= 1)) flag(`"${m[0].trim()}" is not a size the website shows.`);
  }

  // ---- unit numbers
  const units = new Map(pack.units.map((u) => [norm(u.unitNumber), u]));
  for (const m of text.matchAll(/\b(\d{3}[ab]|ph\s?\d[ab]|studio\s1)\b/gi)) {
    const unit = units.get(norm(m[1]));
    if (!unit) flag(`Unit "${m[1]}" is not in the unit list.`);
    else if (unit.status !== "available") flag(`Unit ${unit.unitNumber} is ${unit.status}: check it isn't offered as available.`);
  }

  // ---- links: only real pages of the website
  const host = new URL(SITE_URL).host.replace(/^www\./, "");
  for (const m of text.matchAll(/(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s)>"'\]]*)?/gi)) {
    const raw = m[0].replace(/[.,;:!?]+$/, "");
    if (!/^(?:https?:\/\/|www\.)/i.test(raw) && !raw.includes("/")) continue; // a plain "sales@lexington.com.gh" or "e.g."
    if (/@/.test(text.slice(Math.max(0, (m.index ?? 0) - 1), m.index ?? 0))) continue; // the part after an email's @
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      continue;
    }
    if (url.host.replace(/^www\./, "") !== host) {
      flag(`Links to another website: ${raw}`);
    } else if (!SITE_PATHS.includes(url.pathname.replace(/\/$/, "") || "/")) {
      flag(`Links to a page that doesn't exist: ${raw}`);
    } else if (url.searchParams.get("unit") && !units.has(norm(url.searchParams.get("unit")!))) {
      flag(`Links to a unit that doesn't exist: ${raw}`);
    }
  }

  // ---- dates: only the offer's last day and the estimated completion
  const years = new Set<number>([ESTIMATED_COMPLETION.year, Number(pack.today.slice(0, 4))]);
  if (pack.offer?.endsOn) years.add(Number(pack.offer.endsOn.slice(0, 4)));
  for (const m of text.matchAll(/\b(20\d{2})\b/g)) {
    if (!years.has(Number(m[1]))) flag(`Mentions the year ${m[1]}: check the date.`);
  }
  const months = new Set<string>([ESTIMATED_COMPLETION.monthName, MONTH_NAMES[Number(pack.today.slice(5, 7)) - 1]]);
  if (pack.offer?.endsOn) months.add(MONTH_NAMES[Number(pack.offer.endsOn.slice(5, 7)) - 1]);
  for (const m of text.matchAll(new RegExp(`\\b(${MONTH_NAMES.join("|")})\\b`, "g"))) {
    // "May" is also a word ("May I ask..."): count it only next to a day or a year.
    if (m[1] === "May") {
      const around = text.slice(Math.max(0, (m.index ?? 0) - 8), (m.index ?? 0) + 12);
      if (!/\d\s*(?:st|nd|rd|th)?\s+(?:of\s+)?May|May\s+\d/.test(around)) continue;
    }
    if (!months.has(m[1])) flag(`Mentions ${m[1]}: check the date.`);
  }

  // ---- claims the website never makes
  for (const [pattern, message] of CLAIMS) if (pattern.test(text)) flag(message);

  return found;
}
