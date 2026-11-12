/**
 * The family's story on /about (and the home page's teaser), told the way
 * olympiandevelopments.com tells it (owner, 12 Nov 2026: "update this to match
 * a bit more of the olympian developments website and remove our photos and
 * full names only last name is allowed").
 *
 * PRIVACY RULE: only the family name "Skarlatos" may appear on the public
 * site — no first names and no photographs of family members (copy, alt text,
 * captions, metadata). Generations are told apart by number. Progress photos
 * that show the family on site may stay ("the progress photos with us is fine
 * to leave"), captioned with the surname only.
 *
 * Bios and years still come from Sanity (`familyMember`, in display order) so
 * they stay editable in Studio; a member's name and photo there are for Studio
 * only and are never shown. Everything below is the same record as the
 * Olympian site (olympian-site-v2/lib/content.ts). Nothing here is invented.
 */

export const FAMILY = "Skarlatos";

export const OLYMPIAN_URL = "https://www.olympiandevelopments.com";

/** Public city-centre positions; Shiashie is the Lexington's own pin (lib/maps.ts). */
export const PLACES = {
  shiashie: { name: "Shiashie", lat: 5.63276, lng: -0.1754212 },
  accra: { name: "Accra", lat: 5.6037, lng: -0.187 },
  tema: { name: "Tema", lat: 5.6698, lng: -0.0166 },
  london: { name: "London", lat: 51.5072, lng: -0.1276 },
  abidjan: { name: "Abidjan", lat: 5.36, lng: -4.0083 },
  brasov: { name: "Brasov", lat: 45.6427, lng: 25.5887 },
} as const;

export type PlaceKey = keyof typeof PLACES;

/** Decimal degrees → 05°37′58″N, as a surveyor would note it. */
export function toDMS(value: number, axis: "lat" | "lng") {
  const hemi = axis === "lat" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  // whole seconds, so 59.8″ rounds into the next minute instead of "60″"
  const total = Math.round(Math.abs(value) * 3600);
  const d = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${pad(d, axis === "lat" ? 2 : 3)}°${pad(m)}′${pad(s)}″${hemi}`;
}

export function coordsOf(key: PlaceKey) {
  const p = PLACES[key];
  return `${toDMS(p.lat, "lat")} ${toDMS(p.lng, "lng")}`;
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI"];
const ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth"];

export const romanOf = (i: number) => ROMAN[i] ?? String(i + 1);
export const ordinalOf = (i: number) => ORDINALS[i] ?? `Generation ${i + 1}`;

/** What a generation's plate shows: never a person. */
export interface Plate {
  /** "drawing": black ink on white, printed onto the paper. "photo": cropped to fill. */
  kind: "drawing" | "photo";
  src: string;
  w: number;
  h: number;
  alt: string;
  caption: string;
}

export const TEMA_PLAN: Plate = {
  kind: "drawing",
  src: "/drawings/tema-land-use-plan.webp",
  w: 903,
  h: 807,
  alt: "Land-use plan of Tema: residential communities on a grid of main roads, the industrial area, the harbour and green areas",
  caption: "Tema, land-use plan · family archive",
};

/**
 * Per generation, by Sanity display order (0 = first generation). Bios and
 * years are Sanity's; these add the classification tags, where the work
 * stands, and the plate.
 */
export const GENERATION_PLATES: { tags: string[]; places: PlaceKey[]; plate?: Plate }[] = [
  { tags: ["City planning", "Tema"], places: ["tema"], plate: TEMA_PLAN },
  // No picture yet (drawings of Silver Mountain may come): the plate shows the numeral.
  { tags: ["Headquarters", "Hospitality"], places: ["accra", "brasov"] },
  {
    tags: ["Retail", "Residential"],
    places: ["shiashie"],
    // a Lexington site photograph from the Sanity library (first-floor stage, no family in it)
    plate: {
      kind: "photo",
      src: "https://cdn.sanity.io/images/2p1ef4hj/production/5117fd0bdd4e926c1552585ff3cfbf19b487862a-1536x2048.jpg",
      w: 1536,
      h: 2048,
      alt: "The Lexington under construction: a concrete pump boom over the first-floor column steel",
      caption: "The Lexington, rising · site photograph",
    },
  },
];

export interface RecordEntry {
  name: string;
  location: string;
  period: string;
  current?: boolean;
  /** Index of the generation that led it (0 = first). */
  ledBy: number;
  summary: string;
  places: PlaceKey[];
  link?: { href: string; label: string };
}

/** The family's work, newest first — the same record as the Olympian site's. */
export const RECORD: RecordEntry[] = [
  {
    name: "The Lexington",
    location: "Shiashie, East Legon",
    period: "Rising now",
    current: true,
    ledBy: 2,
    summary: "Eight storeys on Duala Close, opposite Oak Plaza Hotel — what Olympian Developments is building now.",
    places: ["shiashie"],
    link: { href: "/progress", label: "Watch it rise" },
  },
  {
    name: "Private Residence",
    location: "Shiashie, East Legon",
    period: "Completed",
    ledBy: 2,
    summary: "A six-bedroom residence in Shiashie, East Legon.",
    places: ["shiashie"],
  },
  {
    name: "Retail Showrooms",
    location: "London · Accra · Abidjan",
    period: "Completed",
    ledBy: 2,
    summary: "Multiple world-class showrooms across three cities and two continents.",
    places: ["london", "accra", "abidjan"],
  },
  {
    name: "Silver Mountain Resort & Spa",
    location: "Brasov, Romania",
    period: "Completed",
    ledBy: 1,
    summary: "A resort and spa in the Carpathians.",
    places: ["brasov"],
  },
  {
    name: "MTN Headquarters",
    location: "Accra, Ghana",
    period: "Completed",
    ledBy: 1,
    summary: "The MTN Headquarters building in Accra, designed while serving as the company's CFO.",
    places: ["accra"],
  },
  {
    name: "City Planning, Tema",
    location: "Tema, Ghana",
    period: "1960s",
    ledBy: 0,
    summary: "City-wide planning and development of Tema from the ground up, as a Senior Executive at Doxiadis & Associates.",
    places: ["tema"],
  },
];

/** The statement's figures (same as the Olympian site's). */
export const FIGURES = [
  { value: "03", label: "Generations of the Skarlatos family" },
  { value: "1960s", label: "Building in Ghana since" },
  { value: "04", label: "Countries: Ghana, the UK, Côte d'Ivoire, Romania" },
  { value: "08", label: "Storeys rising on Duala Close" },
];
