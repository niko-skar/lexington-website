// The store room's categories (Niko, 2 Nov 2026: "the store room needs to be separated into different categories,
// for example nails and fasteners go in one. consumables go in another that's for cutting discs and drill bits and
// such. you think of others we should separate"). Each item has one; an item that hasn't been given one goes by its
// name (guessCategory) until someone picks.

export const STORE_CATEGORIES = [
  "Cement, grout & additives",
  "Steel & mesh",
  "Nails & fasteners",
  "Consumables",
  "Sealants & chemicals",
  "Timber & formwork",
  "Plumbing",
  "Electrical",
  "Safety gear",
  "Machine parts",
  "Other",
] as const;
export type StoreCategory = (typeof STORE_CATEGORIES)[number];

export const isStoreCategory = (value: unknown): value is StoreCategory => typeof value === "string" && (STORE_CATEGORIES as readonly string[]).includes(value);

/** What each category holds, in a few words (under its heading). */
export const CATEGORY_HINTS: Record<StoreCategory, string> = {
  "Cement, grout & additives": "cement, grout, mortar, additives",
  "Steel & mesh": "rebar, binding wire, BRC, chicken wire",
  "Nails & fasteners": "nails, screws, bolts, anchors",
  Consumables: "cutting discs, drill bits, blades, tape",
  "Sealants & chemicals": "PU foam, silicone, damp proof membrane, form oil",
  "Timber & formwork": "plywood, timber, battens",
  Plumbing: "pipes, fittings, valves",
  Electrical: "cable, conduit, boxes, switches",
  "Safety gear": "gloves, helmets, boots, vests",
  "Machine parts": "vibrator hoses, mixer parts, plugs, belts",
  Other: "anything else",
};

// In order: the first that fits wins (solvent cement is plumbing, a wood cutting disc a consumable, binding wire steel).
const RULES: Array<[StoreCategory, RegExp]> = [
  ["Plumbing", /solvent cement|\bpipes?\b|\bpvc\b|\bppr\b|fitting|elbow|\btees?\b|valve|\btaps?\b|\btraps?\b|drain|sewer|gull(y|ies)|reducer|union\b|tank\b/i],
  ["Consumables", /\bdiscs?\b|\bdisks?\b|drill bit|\bbits?\b|blade|sand ?paper|abrasive|grinding|cutting|masking|\btapes?\b|brush|roller|sponge|marker|chalk|string line|\bpegs?\b/i],
  ["Steel & mesh", /\bsteel\b|rebar|iron rod|\brods?\b|\bbrc\b|mesh|binding wire|tie wire|chicken wire|\bhigh tensile\b/i],
  ["Nails & fasteners", /\bnails?\b|screws?|\bbolts?\b|\bnuts?\b|washers?|anchors?|rivets?|staples?|fasteners?|hooks?\b|hinges?/i],
  ["Cement, grout & additives", /cement|grout|mortar|additive|admixture|plaster|\blime\b|screed|crystalline|tile adhesive|bonding agent|\bsbr\b/i],
  ["Sealants & chemicals", /foam|silicone|sealant|caulk|waterproof|bitumen|primer|form oil|release agent|curing compound|membrane|\bdpm\b|damp proof|\bglue\b|adhesive|paint|thinner|polyur/i],
  ["Timber & formwork", /plywood|\bply\b|timber|\bwood\b|board|formwork|batten|shutter|lumber|\bprops?\b/i],
  ["Electrical", /cable|conduit|switch|socket|bulb|lamp|breaker|\bdb\b|junction|electrical|\bflex\b|\bwire\b/i],
  ["Safety gear", /glove|helmet|hard hat|boots?\b|\bvests?\b|goggle|\bmasks?\b|ear (plug|muff)|harness|first aid|safety/i],
  ["Machine parts", /\bhoses?\b|vibrator|poker|mixer|engine|spark plug|\bplugs?\b|\bbelts?\b|filter|\boil\b|grease|spare|\bpump\b|generator|bearing|clutch/i],
];

/** The category an item's name suggests ("Other" when nothing fits). */
export function guessCategory(name: string): StoreCategory {
  for (const [category, re] of RULES) if (re.test(name)) return category;
  return "Other";
}

/** An item's category: the one it was given, else what its name suggests. */
export const categoryOf = (item: { name: string; category?: string | null }): StoreCategory => (isStoreCategory(item.category) ? item.category : guessCategory(item.name));
