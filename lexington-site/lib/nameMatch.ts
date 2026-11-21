/**
 * How alike two Ghanaian names are (21 Nov 2026): the name a worker gave the site and the name their Mobile Money
 * account is registered in (lib/rollcall/momoName.ts). Niko: "a lot of the time it's not the same as their actual
 * name and I want to have it double confirmed before I send any money to an account".
 *
 * WHY THIS IS NOT A BOOLEAN
 * -------------------------
 * Ghanaian naming reality breaks exact comparison constantly, and in ways that are innocent far more often than not:
 *
 *   · Order is not fixed. "Owusu Kwame" and "Kwame Owusu" are the same person.
 *   · Middle names come and go. MTN MoMo registration often carries only two names where the Ghana Card has three.
 *   · Spelling is dialectal, not canonical. Kwabena / Kobina, Adwoa / Adjoa, Serwaa / Serwah, Agyeman / Agyemang.
 *   · Initials are normal on official paperwork: "K. M. Owusu".
 *
 * So this returns a score AND a three-way band (match / partial / mismatch), and the middle band is for a person to
 * look at. The variant table and the phonetic rules below encode Ghanaian spelling specifically. It is pure and
 * dependency-free.
 */

export type NameMatchBand = "match" | "partial" | "mismatch";

export interface NameTokenPair {
  a: string;
  b: string;
  score: number;
  /** Why these two were considered the same name. */
  basis: "exact" | "variant" | "phonetic" | "initial" | "prefix" | "spelling" | "weak";
}

export interface NameComparison {
  /** 0–1, rounded to two decimals. */
  score: number;
  band: NameMatchBand;
  /** Plain-language notes for the admin reviewing a `partial`. */
  reasons: string[];
  /** How each name part was paired up. Shown in the review queue. */
  pairs: NameTokenPair[];
  /** Name parts present in one name and not the other. */
  extras: string[];
  /** True when one or both names were empty — the caller should not band this. */
  insufficientData: boolean;
}

/* -------------------------------------------------------------------------
 * Thresholds
 *
 * Exported so the admin UI can explain a decision with the same numbers the
 * scorer used, and so the tests assert against one definition rather than
 * copies of the magic numbers.
 * ---------------------------------------------------------------------- */

/** At or above this, accept without a human. */
export const MATCH_THRESHOLD = 0.9;

/** At or above this (but below MATCH), queue for review. Below it, reject. */
export const PARTIAL_THRESHOLD = 0.6;

/**
 * One name part in common is never enough to accept outright, however well
 * it matches — "Owusu" against "Kwame Owusu" is one of the most common
 * surnames in the country matching one of the most common surnames in the
 * country.
 */
const SINGLE_TOKEN_CEILING = 0.65;

/**
 * With two or more parts on each side, at least two of them have to
 * corroborate. Otherwise "Kwame Owusu" vs "Akosua Owusu" — a relative's
 * MoMo account, the classic case — would score on the surname alone.
 */
const WEAK_EVIDENCE_CEILING = 0.55;

/** A pair this good counts towards the "two parts corroborate" rule. */
const CORROBORATION_FLOOR = 0.7;

/** Shortest stem that may count as a shortened form of a longer name. */
const MIN_PREFIX_LENGTH = 3;

/** Per extra name part present on one side only. Capped — see `EXTRA_PENALTY_CAP`. */
const EXTRA_TOKEN_PENALTY = 0.04;
const EXTRA_PENALTY_CAP = 0.12;

/* -------------------------------------------------------------------------
 * Normalisation
 * ---------------------------------------------------------------------- */

/**
 * Titles that are never anything but a title. Always removed.
 */
const HARD_TITLES = new Set([
  "mr", "mrs", "ms", "miss", "mister", "master", "madam", "mad",
  "dr", "doctor", "prof", "professor", "eng", "engr",
  "rev", "reverend", "pastor", "bishop", "apostle", "evangelist",
  "hon", "honourable", "honorable",
  "alhaji", "alhaja", "hajia", "hajj",
  "jnr", "jr", "snr", "sr", "esq", "ii", "iii", "iv",
]);

/**
 * Words that are BOTH a title and a genuine given name.
 *
 * "Nana" is the case that matters: Nana Akufo-Addo is a name, Nana Yaa is a
 * title plus a name, and nothing in the string says which. So these are only
 * dropped when at least two other parts survive — "Nana Ama Mensah" loses the
 * title, "Nana Owusu" keeps it, because throwing it away there would leave a
 * single surname and a guaranteed trip to the review queue.
 */
const SOFT_TITLES = new Set([
  "nana", "naa", "nii", "togbe", "torgbe", "osabarima", "obaapanin",
]);

/**
 * Spelling variants that edit distance and the phonetic key both miss —
 * mostly cross-dialect forms of the Akan day-names, where the written forms
 * diverge much further than the pronunciation.
 *
 * Deliberately conservative: only orthographic variants of the *same* name.
 * Cross-dialect equivalents that are genuinely different names (Fante "Fiifi"
 * for Akan "Kofi") are NOT here — treating them as identical would invent
 * matches between two different people born on the same day of the week.
 */
const VARIANT_GROUPS: readonly (readonly string[])[] = [
  // Akan day-names, male
  ["kwasi", "kwesi", "kwashi", "quesi"],
  ["kwadwo", "kwadjo", "kojo", "kodjo", "kudjoe", "cudjoe"],
  ["kwabena", "kobina", "kobena", "kwabina", "kabena"],
  ["kwaku", "kweku", "kwakou", "quaku"],
  ["yaw", "yao", "yaw"],
  ["kofi", "koffi", "kwofi", "coffie"],
  ["kwame", "kwamena", "kwamina", "quame"],
  // Akan day-names, female
  ["adwoa", "adjoa", "adjua", "adwowa", "adjowa"],
  ["abena", "abenaa", "abina", "araba"],
  ["akua", "akuah", "ekua", "ekuah"],
  ["afua", "afia", "afi", "afuah", "efua", "efia"],
  ["akosua", "akosuah", "akousua", "akwasiba"],
  // Frequent family names whose variants differ by more than a letter
  ["frimpong", "frempong"],
  ["agyeman", "agyemang", "adjeman", "ageman"],
  ["asamoah", "asamoa", "asmoah"],
  ["adjei", "agyei", "adjey"],
  ["bediako", "bedako", "bediaku"],
  ["tetteh", "tettey", "tete", "tettei"],
  ["quartey", "quartei", "kwartey"],
  ["amoah", "amuah", "amoa"],
  ["baidoo", "baido", "baidu"],
  ["nyarko", "nyako", "nyarkoh"],
  ["sarpong", "sapong", "sarpon"],
  ["yeboah", "yeboa", "yebuah"],
  // Common non-Akan Ghanaian names
  ["mohammed", "mohamed", "muhammed", "muhammad", "mohammad", "mahmud"],
  ["ibrahim", "ibrahima", "brahim"],
  ["issah", "isah", "isa", "issa"],
  ["abdul", "abdool", "abdoul"],
  ["emmanuel", "emanuel", "emmanuella"],
];

const VARIANT_KEYS = new Map<string, string>();
for (const group of VARIANT_GROUPS) {
  const canonical = group[0];
  for (const form of group) VARIANT_KEYS.set(form, canonical);
}

/** Strips accents, punctuation and case; splits on whitespace and hyphens are kept. */
function normalise(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Splits a name into comparable parts.
 *
 * A hyphenated name stays ONE part ("owusu-ansah" -> "owusuansah") rather
 * than becoming two. That is what makes "Kwame Owusu" against
 * "Kwame Owusu-Ansah" land in `partial` instead of `match`: dropping half a
 * double-barrelled surname is common enough to be innocent, and different
 * enough to be worth a glance.
 */
export function nameParts(raw: string): string[] {
  const normalised = normalise(raw);
  if (!normalised) return [];

  const parts = normalised
    .split(" ")
    .map((part) => part.replace(/-/g, ""))
    .filter(Boolean);

  // Hard titles always go; falling back only if that would leave nothing.
  const withoutHard = parts.filter((part) => !HARD_TITLES.has(part));
  const base = withoutHard.length > 0 ? withoutHard : parts;

  // Soft titles go only when the name can spare them.
  const withoutSoft = base.filter((part) => !SOFT_TITLES.has(part));
  return withoutSoft.length >= 2 ? withoutSoft : base;
}

function isInitial(part: string): boolean {
  return part.length === 1;
}

/**
 * A pronunciation-shaped key, tuned for Ghanaian orthography.
 *
 * Each rule earns its place against a real pair of spellings:
 *   qu -> kw     Quaye / Kwaye, Quartey / Kwartey
 *   gy/dj/dz -> j   Agyeman / Ajeman, Adjoa, Dzokoto
 *   ky -> ch     Kyei / Chei
 *   sh -> s      Ashanti / Asante
 *   doubled letters collapse   Annan / Anan, Tetteh / Teteh
 *   repeated vowels collapse   Serwaa / Serwa, Baidoo / Baido, Yaa / Ya
 *   trailing h/y after a vowel drops   Mensah / Mensa, Akuah / Akua, Tettey / Tette
 *   trailing ng -> n   Agyemang / Agyeman, Boateng / Boaten
 *
 * It is a similarity aid, never an identity claim on its own — a phonetic
 * hit scores 0.94, not 1.0, precisely because these rules over-merge.
 */
export function phoneticKey(part: string): string {
  let key = part.toLowerCase().replace(/[^a-z]/g, "");
  if (!key) return "";

  key = key
    .replace(/ph/g, "f")
    .replace(/qu/g, "kw")
    .replace(/ck/g, "k")
    .replace(/x/g, "ks")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/c/g, "k")
    .replace(/dz/g, "j")
    .replace(/dj/g, "j")
    .replace(/gy/g, "j")
    .replace(/ky/g, "ch")
    .replace(/sh/g, "s");

  // Collapse any doubled letter: "annan" -> "anan", "tetteh" -> "teteh".
  key = key.replace(/(.)\1+/g, "$1");

  // Trailing decorations that carry no sound in these names.
  key = key.replace(/ng$/, "n");
  key = key.replace(/([aeiou])[hy]$/, "$1");

  return key;
}

function variantKey(part: string): string {
  return VARIANT_KEYS.get(part) ?? part;
}

/** Classic Levenshtein distance. Names are short; the O(mn) table is free. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function editSimilarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(a, b) / longest;
}

/**
 * How alike two single name parts are, and why.
 *
 * The `basis` matters as much as the number: the admin queue shows it, so a
 * reviewer can see at a glance whether a 0.75 came from an initial (fine,
 * just thin) or from two names that merely look alike (not fine).
 */
export function comparePart(rawA: string, rawB: string): { score: number; basis: NameTokenPair["basis"] } {
  const a = rawA;
  const b = rawB;

  if (a === b) return { score: 1, basis: "exact" };

  // An initial is real but thin evidence: "K." is consistent with Kwame,
  // and with Kofi, and with Kwabena.
  if (isInitial(a) || isInitial(b)) {
    const initial = isInitial(a) ? a : b;
    const full = isInitial(a) ? b : a;
    return full.startsWith(initial) ? { score: 0.75, basis: "initial" } : { score: 0, basis: "weak" };
  }

  if (variantKey(a) === variantKey(b)) return { score: 0.97, basis: "variant" };
  if (phoneticKey(a) === phoneticKey(b)) return { score: 0.94, basis: "phonetic" };

  const edit = editSimilarity(a, b);
  const phoneticEdit = editSimilarity(phoneticKey(a), phoneticKey(b)) * 0.98;
  const best = Math.max(edit, phoneticEdit);

  // One name contained in the other from the start — a dropped half of a
  // double-barrelled name ("Owusu" / "Owusu-Ansah"), or a shortened given
  // name ("Ben" / "Benjamin"). Three characters is the floor: two would pair
  // "Ad" with half the surnames in Accra. Even at three this is only worth
  // 0.7, which cannot reach `match` on its own — "Ama" and "Amankwah" share a
  // stem and are different names, so the pair goes to a human, not through.
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length >= MIN_PREFIX_LENGTH && longer.startsWith(shorter)) {
    return { score: Math.max(0.7, best), basis: "prefix" };
  }

  return { score: best, basis: best >= 0.8 ? "spelling" : "weak" };
}

/**
 * Pairs up name parts regardless of order, best match first.
 *
 * Greedy rather than optimal (Hungarian): with at most a handful of parts
 * the two agree in every realistic case, and greedy stays readable — which
 * matters for something that has to be explainable to someone who was
 * refused.
 */
function pairUp(a: string[], b: string[]): { pairs: NameTokenPair[]; extras: string[] } {
  const candidates: NameTokenPair[] = [];
  for (const partA of a) {
    for (const partB of b) {
      const { score, basis } = comparePart(partA, partB);
      if (score > 0) candidates.push({ a: partA, b: partB, score, basis });
    }
  }
  candidates.sort((x, y) => y.score - x.score);

  const usedA = new Set<string>();
  const usedB = new Set<string>();
  const pairs: NameTokenPair[] = [];

  for (const candidate of candidates) {
    if (usedA.has(candidate.a) || usedB.has(candidate.b)) continue;
    usedA.add(candidate.a);
    usedB.add(candidate.b);
    pairs.push(candidate);
  }

  const extras = [
    ...a.filter((part) => !usedA.has(part)),
    ...b.filter((part) => !usedB.has(part)),
  ];

  return { pairs, extras };
}

/** The band a score falls in. Exported so the UI explains the same rule. */
export function bandFor(score: number): NameMatchBand {
  if (score >= MATCH_THRESHOLD) return "match";
  if (score >= PARTIAL_THRESHOLD) return "partial";
  return "mismatch";
}

function buildReasons(
  partsA: string[],
  partsB: string[],
  pairs: NameTokenPair[],
  extras: string[],
  ceilingApplied: "single" | "weak" | null
): string[] {
  const reasons: string[] = [];

  const exactInOrder = partsA.length === partsB.length && partsA.every((p, i) => p === partsB[i]);
  if (!exactInOrder && pairs.some((p) => p.basis === "exact")) {
    const reordered = pairs.some((p) => partsA.indexOf(p.a) !== partsB.indexOf(p.b));
    if (reordered) reasons.push("The same names appear in a different order.");
  }

  for (const pair of pairs) {
    if (pair.basis === "initial") {
      reasons.push(`“${pair.a}” and “${pair.b}” matched as an initial — thinner evidence than a full name.`);
    } else if (pair.basis === "variant") {
      reasons.push(`“${pair.a}” and “${pair.b}” are known spelling variants of the same name.`);
    } else if (pair.basis === "phonetic") {
      reasons.push(`“${pair.a}” and “${pair.b}” differ only in spelling.`);
    } else if (pair.basis === "prefix") {
      reasons.push(`“${pair.a}” and “${pair.b}” share a stem — one looks like a shortened form.`);
    } else if (pair.basis === "weak") {
      reasons.push(`“${pair.a}” and “${pair.b}” do not look like the same name.`);
    }
  }

  if (extras.length > 0) {
    reasons.push(
      `${extras.length} name part${extras.length === 1 ? "" : "s"} (${extras
        .map((e) => `“${e}”`)
        .join(", ")}) appear${extras.length === 1 ? "s" : ""} on only one side.`
    );
  }

  if (ceilingApplied === "single") {
    reasons.push("Only one name part in common — not enough on its own, however well it matches.");
  } else if (ceilingApplied === "weak") {
    reasons.push("Fewer than two name parts corroborate; a shared surname alone is not evidence of the same person.");
  }

  return reasons;
}

/**
 * Compares a verified identity name against a Mobile Money account name.
 *
 * Order of arguments does not matter — the comparison is symmetric, which is
 * the point (see the note on ordering at the top of the file).
 */
export function compareNames(nameA: string, nameB: string): NameComparison {
  const partsA = nameParts(nameA ?? "");
  const partsB = nameParts(nameB ?? "");

  if (partsA.length === 0 || partsB.length === 0) {
    return {
      score: 0,
      band: "mismatch",
      reasons: ["One of the names was empty, so there was nothing to compare."],
      pairs: [],
      extras: [],
      insufficientData: true,
    };
  }

  const { pairs, extras } = pairUp(partsA, partsB);
  const smaller = Math.min(partsA.length, partsB.length);
  const larger = Math.max(partsA.length, partsB.length);

  const matched = pairs.reduce((sum, pair) => sum + pair.score, 0);
  const base = matched / smaller;

  const extraCount = larger - smaller;
  const penalty = Math.min(extraCount * EXTRA_TOKEN_PENALTY, EXTRA_PENALTY_CAP);

  let score = base - penalty;
  let ceilingApplied: "single" | "weak" | null = null;

  if (smaller === 1 && score > SINGLE_TOKEN_CEILING) {
    score = SINGLE_TOKEN_CEILING;
    ceilingApplied = "single";
  }

  const corroborating = pairs.filter((pair) => pair.score >= CORROBORATION_FLOOR).length;
  if (smaller >= 2 && corroborating < 2 && score > WEAK_EVIDENCE_CEILING) {
    score = WEAK_EVIDENCE_CEILING;
    ceilingApplied = "weak";
  }

  score = Math.round(Math.max(0, Math.min(1, score)) * 100) / 100;

  return {
    score,
    band: bandFor(score),
    reasons: buildReasons(partsA, partsB, pairs, extras, ceilingApplied),
    pairs,
    extras,
    insufficientData: false,
  };
}

/** Percentage form for the UI, e.g. `0.83` -> `"83%"`. */
export function formatNameScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}

/* -------------------------------------------------------------------------
 * The automatic Mobile Money check
 * ---------------------------------------------------------------------- */
