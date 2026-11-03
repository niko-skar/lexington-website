// The store room's categories (Niko, 2 Nov 2026: "the store room needs to be separated into different categories,
// for example nails and fasteners go in one. consumables go in another that's for cutting discs and drill bits and
// such. you think of others we should separate"). Each item has one; an item that hasn't been given one goes by its
// name (guessCategory) until someone picks.

import { isTrade, type Trade } from "./shared";

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

/* ---------- who uses it (Niko, 3 Nov 2026: "Tool department carpenter, mason, or Steelbender ... Same for materials") ---------- */

// Materials: their category says most of it; names settle the rest (form oil is the carpenters', tile adhesive the
// masons'). Anything else is everyone's.
const ITEM_TRADE_BY_CATEGORY: Partial<Record<StoreCategory, Trade>> = {
  "Timber & formwork": "carpentry",
  "Nails & fasteners": "carpentry",
  "Cement, grout & additives": "masonry",
  "Steel & mesh": "steel",
};
const ITEM_TRADE_RULES: Array<[Trade, RegExp]> = [
  ["steel", /rebar|\brods?\b|binding wire|tie wire|\bbrc\b|spacer|\bchairs?\b/i],
  ["carpentry", /form oil|release agent|plywood|timber|\bwood\b|batten|nails?\b|hinge/i],
  ["masonry", /cement|\bblocks?\b|\bsand\b|chipping|stone|quarry|mortar|plaster|\btiles?\b|tile adhesive|grout|\blime\b|screed|\bdpm\b|damp proof/i],
];

/** Who a material is for, by its category and name ("all" when nothing says). */
export function guessItemTrade(name: string, category: StoreCategory = guessCategory(name)): Trade {
  const byCategory = ITEM_TRADE_BY_CATEGORY[category];
  if (byCategory) return byCategory;
  for (const [trade, re] of ITEM_TRADE_RULES) if (re.test(name)) return trade;
  return "all";
}

// Tools: in order, the first that fits wins (a club hammer is the masons', a claw hammer the carpenters'; a grinder,
// a drill or a ladder everyone's).
const TOOL_TRADE_RULES: Array<[Trade, RegExp]> = [
  ["steel", /bar bend|bending|rebar|bolt cutter|steel cutter|\bpincers?\b|tie wire|binding|\bsteel\b/i],
  ["masonry", /club hammer|lump hammer|sledge|trowel|\bfloats?\b|spirit level|\bshovels?\b|\bspades?\b|head ?pans?|wheel ?barrows?|pick ?axe|mattock|block mou?ld|rammer|compactor|vibrator|poker|mixer|\bsieve\b|jointer|plumb ?bob|tile cutter/i],
  ["carpentry", /\bsaws?\b|circular|jig ?saw|hammer|claw|chisel|\bplane\b|router|\bsquare\b|nail gun|\bclamps?\b|crow ?bar|pinch bar|\bwood\b|formwork/i],
];

/** Who a tool is for, by its name ("all" when nothing says). */
export function guessToolTrade(name: string): Trade {
  for (const [trade, re] of TOOL_TRADE_RULES) if (re.test(name)) return trade;
  return "all";
}

/** A material's trade: the one it was given, else what its category and name suggest. */
export const tradeOfItem = (item: { name: string; category?: string | null; trade?: string | null }): Trade =>
  isTrade(item.trade) ? item.trade : guessItemTrade(item.name, categoryOf(item));
/** A tool's trade: the one it was given, else what its name suggests. */
export const tradeOfTool = (tool: { name: string; trade?: string | null }): Trade => (isTrade(tool.trade) ? tool.trade : guessToolTrade(tool.name));
