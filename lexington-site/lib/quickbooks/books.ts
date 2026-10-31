// The Lexington's QuickBooks classes and locations, as the site app uses them (Niko, 30 Oct 2026: "I also need
// to add locations and classes as that's set up in a specific way on quickbooks that the site expenses needs to
// match"). In his books the class is the cost type ("Materials:Cement Bags", "Labour:Carpenters", "Equipment
// Rental:Acrow Jacks"...) and the location is the stage or floor ("Foundations", "Ground Floor", "First Floor",
// "Stormdrain"). Each site expense now carries a class (suggested from what it is, changeable) and its floor
// gives the location; wages from Payday get the class of each worker's trade. Used by the phone (the form's
// suggestions) and the server (what goes to QuickBooks), so nothing here talks to anyone.

export interface BookNamed {
  id: string;
  /** As QuickBooks shows it, with its parent: "Materials:Cement Bags". */
  name: string;
}

/** The company's classes and locations as last read from QuickBooks (kept in the website, lib/quickbooks/booksCache.ts). */
export interface BookLists {
  classes: BookNamed[];
  locations: BookNamed[];
  fetchedAt: string | null;
}

/** A class or location chosen on an entry: its id, and its name for showing it (and finding it again if renamed). */
export type CostClass = BookNamed;

const ORDINAL_WORDS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];

/** A floor or location's name to compare by: "1st floor" and "First Floor" are both "firstfloor". */
export const areaKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/g, (_, n: string) => ORDINAL_WORDS[Number(n) - 1] ?? n)
    .replace(/[^a-z0-9]/g, "");

/** The QuickBooks location for an expense's floor or area ("Ground floor" -> "Ground Floor"), if the books have one. */
export function locationForArea(area: string | null | undefined, locations: readonly BookNamed[]): BookNamed | null {
  if (!area) return null;
  const key = areaKey(area);
  return locations.find((l) => areaKey(l.name.split(":").pop() ?? l.name) === key) ?? null;
}

/**
 * The areas to offer on a site expense: the app's floors, plus the books' locations that aren't a floor
 * ("Foundations" first, the others such as "Stormdrain" before "Whole building").
 */
export function areasWith(floors: readonly string[], locations: readonly BookNamed[]): string[] {
  const keys = new Set(floors.map(areaKey));
  const extra = locations.map((l) => l.name.split(":").pop() ?? l.name).filter((n) => !keys.has(areaKey(n)));
  const first = extra.filter((n) => /foundation/i.test(n));
  const rest = extra.filter((n) => !/foundation/i.test(n));
  const whole = floors.indexOf("Whole building");
  const body = whole >= 0 ? [...floors.slice(0, whole), ...rest, ...floors.slice(whole)] : [...floors, ...rest];
  return [...first, ...body];
}

/** A class by its name in the books (any case), or its parent's when the books have no such sub-class. */
export function classNamed(name: string, classes: readonly BookNamed[]): BookNamed | null {
  const find = (n: string) => classes.find((c) => c.name.toLowerCase() === n.toLowerCase()) ?? null;
  return find(name) ?? (name.includes(":") ? find(name.split(":")[0]) : null);
}

/** The words that say which cost type an expense is (checked in order: the first that fits wins). */
const CLASS_WORDS: Array<[RegExp, string]> = [
  [/ready ?mix|readymix|consar|premix/i, "Concrete Ready Mix"],
  [/acrow|\bprops?\b|scaffold/i, "Equipment Rental:Acrow Jacks"],
  [/bending machine|cutting machine|steel machine|bender machine/i, "Equipment Rental:Steel Machine Rentals"],
  [/excavator|tipper|roller|crane|bulldozer|backhoe|compactor|poker|vibrator|concrete mixer/i, "Equipment Rental:Heavy Equipment Rental"],
  [/\bhire\b|rental|\brent\b/i, "Equipment Rental"],
  [/diesel|petrol|fuel|gas oil/i, "Fuel"],
  [/steel bend|bending labou?r|steel bender/i, "Labour:Steel Benders"],
  [/carpent/i, "Labour:Carpenters"],
  [/mason|labou?rer|payroll|\bwages?\b|labou?r for the week|all labou?r/i, "Labour:Masons & Labourers"],
  [/electric/i, "Specialists:Electricians"],
  [/plumb/i, "Specialists:Plumbers"],
  [/borehole|surveyor|engineer|architect|consult|geotech|soil test/i, "Specialists"],
  [/supervis/i, "Supervisor"],
  [/cement/i, "Materials:Cement Bags"],
  [/\bblocks?\b/i, "Materials:Blocks"],
  [/sand|chipping|quarry dust|stone dust|gravel/i, "Materials:Sand & Chippings"],
  [/\brocks?\b|boulder/i, "Materials:Rocks & Boulders"],
  [/iron rod|\brods?\b|rebar|\bsteel\b|binding wire|\bbrc\b|mesh/i, "Materials:Steel"],
  [/wood|timber|plywood|\bboards?\b|formwork|batten|shutter/i, "Materials:Wood & Formwork"],
  [/\bnails?\b|consumable|polythene|\btape\b|\bblades?\b|sack/i, "Materials:Consumables fx Nails"],
  [/membrane|\bdpm\b|damp ?proof/i, "Materials:Damp Proof Membrane"],
  [/transport|delivery|haulage|\btruck\b|trotro|\btaxi\b|uber|bolt/i, "Transport"],
  [/repair|maintenance|servic(e|ing) of/i, "Repairs and Maintenance"],
  [/permit|stamp|official|paperwork|lands commission|assembly|registration/i, "Official and Paperwork"],
  [/stationer|printing|\bpens?\b|\bpaper\b/i, "Stationary"],
  [/\btools?\b|shovel|wheelbarrow|hammer|spirit level|trowel|\bdrill\b|pickaxe|head ?pan/i, "Tools"],
  [/\becg\b|electricity bill|water bill|utilit|internet|airtime|credit top/i, "Utilities"],
  [/laptop|computer|software|printer|\bit\b|tech/i, "IT & Tech"],
];

export interface ClassedEntry {
  category: string | null;
  material: string | null;
  description: string;
  supplier: string;
  costClass?: CostClass | null;
}

/**
 * The class to suggest for an expense: what the same material (or else the same supplier) was given last time,
 * else what its words say, else Materials for a material. Null when nothing fits (the office chooses).
 */
export function guessClass(x: ClassedEntry, classes: readonly BookNamed[], history: readonly ClassedEntry[] = []): BookNamed | null {
  if (!classes.length) return null;
  const known = (c: CostClass | null | undefined) => (c ? (classes.find((k) => k.id === c.id) ?? classNamed(c.name, classes)) : null);
  const same = (a: string | null, b: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
  if (x.material) {
    const hit = history.find((h) => h.costClass && same(h.material, x.material));
    if (hit && known(hit.costClass)) return known(hit.costClass);
  }
  if (x.supplier) {
    const hit = history.find((h) => h.costClass && same(h.supplier, x.supplier));
    if (hit && known(hit.costClass)) return known(hit.costClass);
  }
  // A material's own words first ("Cement delivered" is cement); for a service, what was done ("Transport of blocks").
  const words = [x.material ?? "", x.description, x.supplier].join(" ");
  const isGoods = (name: string) => name.startsWith("Materials") || name === "Concrete Ready Mix";
  const material = x.category === "Material";
  const rules = [...CLASS_WORDS.filter(([, n]) => isGoods(n) === material), ...CLASS_WORDS.filter(([, n]) => isGoods(n) !== material)];
  for (const [re, name] of rules) if (re.test(words)) {
    const c = classNamed(name, classes);
    if (c) return c;
  }
  return material ? classNamed("Materials", classes) : null;
}

/** The class for a worker's pay, by the roll call's trade group ("masonry", "carpentry", "steel"), and for the steel machines. */
export const TRADE_CLASS: Record<string, string> = {
  masonry: "Labour:Masons & Labourers",
  carpentry: "Labour:Carpenters",
  steel: "Labour:Steel Benders",
  machines: "Equipment Rental:Steel Machine Rentals",
};
