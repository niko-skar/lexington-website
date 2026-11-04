// Doubles in the store room (Niko, 4 Nov 2026: "add a duplicate check so these nimrods don't double add things, have it
// check the photo too and mark if it's similar for me as well"). Whoever adds something is asked "Is it one of these?"
// when it looks like something already on the list (by its name, and by its photo: lib/store/doublesCheck.ts); what's
// added anyway carries the look-alikes onto the office's "To check". This file is the name half, used on the server
// and the phone alike: names the way the site types them ("Drill bit10", "12mm Drill bit", "Pu- Foam", "Wawa board 10
// pcs") brought to the same words, and how close two names are.

/** One entry it might be the same as: a material ("item") or a tool, and why it looks like it. */
export interface StoreDouble {
  kind: "item" | "tool";
  id: string;
  why: string;
  /** Sure it's the same thing (same photo, same name in other words); otherwise it might be. */
  sure: boolean;
}

/** At most this many are shown (the likeliest first). */
export const MAX_DOUBLES = 3;
export const MAX_DOUBLE_WHY = 160;

// "10 pcs", "3 buckets", "5 bags" in a name say how many, not what it is.
const COUNT_WORDS = new Set([
  "pc", "pcs", "piece", "pieces", "no", "nos", "bag", "bags", "box", "boxes", "roll", "rolls", "sheet", "sheets", "length", "lengths",
  "bundle", "bundles", "tin", "tins", "bucket", "buckets", "gallon", "gallons", "set", "sets", "pair", "pairs", "pack", "packs", "carton", "cartons",
]);
const STOP = new Set(["of", "the", "and", "for", "with", "an", "to", "in", "on", "at", "by", "or", "x", "new", "old", "type", "size"]);
// "Small" and "big" say which one, like a size: a small and a big wall hammer are two things.
const SIZE_WORDS: Record<string, string> = { small: "small", mini: "small", big: "big", large: "big", medium: "medium", long: "long", short: "short" };
// Words the site writes more than one way.
const SAME_WORD: Record<string, string> = { pu: "polyurethane", polyurthane: "polyurethane", poly: "polyurethane", ply: "plywood" };

/** The words of a name and its sizes ("12mm", "4in", "42.5r"), in one form whatever way it was typed. */
export function nameParts(name: string): { words: string[]; sizes: string[] } {
  const text = name
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/(\d)\s*(?:["”“″]|''|inch(?:es)?\b)/g, "$1in ")
    .replace(/(\d),(\d)/g, "$1.$2");
  const words: string[] = [];
  const sizes: string[] = [];
  const tokens = text.match(/\d+(?:\.\d+)?[a-z]{0,3}|[a-z]+/g) ?? [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (/^\d/.test(t)) {
      const unit = t.replace(/^[\d.]+/, "");
      // A number and then "pcs" (or a number with it stuck on, "10pcs"): how many, not what.
      if (COUNT_WORDS.has(unit) || (!unit && COUNT_WORDS.has(tokens[i + 1] ?? ""))) {
        if (!unit) i++;
        continue;
      }
      sizes.push(t);
      continue;
    }
    if (SIZE_WORDS[t]) {
      sizes.push(SIZE_WORDS[t]);
      continue;
    }
    if (STOP.has(t) || COUNT_WORDS.has(t) || t.length < 2) continue;
    words.push(stem(SAME_WORD[t] ?? t));
  }
  return { words: [...new Set(words)], sizes: [...new Set(sizes)] };
}

// "drilling" is "drill", "cutting" is "cutt" (sameWord takes that for "cut").
function stem(word: string): string {
  let w = word;
  if (w.length >= 6 && w.endsWith("ing")) w = w.slice(0, -3);
  if (w.length >= 4 && w.endsWith("es") && /(ch|sh|x|ss)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length >= 4 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  return w;
}

/** Letters apart, a swap of two counting as one (so "sqaure" is one from "square"). */
function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

const doubledEnd = (long: string, short: string) => long.length === short.length + 1 && long.startsWith(short) && long.at(-1) === long.at(-2);
const sameWord = (a: string, b: string) =>
  a === b ||
  doubledEnd(a, b) ||
  doubledEnd(b, a) ||
  (Math.min(a.length, b.length) >= 5 && distance(a, b) <= (Math.min(a.length, b.length) >= 9 ? 2 : 1));
// "12" and "12mm" are the same size; "12mm" and "10mm" aren't, nor "small" and "big".
const sizeNumber = (s: string) => s.replace(/[a-z]+$/, "");
const sameSize = (a: string, b: string) => a === b || (/^\d/.test(a) && /^\d/.test(b) && sizeNumber(a) === sizeNumber(b) && (a === sizeNumber(a) || b === sizeNumber(b)));

/**
 * How alike two names are, 0 to 1: the share of the shorter name's words the other has too (spelling slips forgiven),
 * a little less when the longer one says much more, and half when both give a size and no size is the same.
 */
export function nameScore(a: string, b: string): number {
  const x = nameParts(a);
  const y = nameParts(b);
  if (!x.words.length || !y.words.length) return 0;
  const [short, long] = x.words.length <= y.words.length ? [x.words, y.words] : [y.words, x.words];
  const shared = short.filter((w) => long.some((v) => sameWord(w, v))).length;
  if (!shared) return 0;
  const contained = shared / short.length;
  const jaccard = shared / (short.length + long.length - shared);
  let score = 0.75 * contained + 0.25 * jaccard;
  if (x.sizes.length && y.sizes.length && !x.sizes.some((s) => y.sizes.some((t) => sameSize(s, t)))) score *= 0.5;
  return Math.round(score * 1000) / 1000;
}

/** The best of a name's score against an entry's name and the names it had before. */
export const bestScore = (name: string, names: readonly string[]) => Math.max(0, ...names.map((n) => nameScore(name, n)));

/** Only these, cleaned: kind and id as they should be, a short reason; at most MAX_DOUBLES, no repeats. */
export function cleanDoubleList(value: unknown): StoreDouble[] | null {
  if (!Array.isArray(value)) return null;
  const out: StoreDouble[] = [];
  for (const d of value) {
    if (!d || typeof d !== "object") continue;
    const { kind, id, why, sure } = d as Record<string, unknown>;
    if ((kind !== "item" && kind !== "tool") || typeof id !== "string" || !/^[a-z]+-[a-z]+-[a-zA-Z0-9]+$/.test(id)) continue;
    if (out.some((o) => o.id === id)) continue;
    out.push({ kind, id, why: typeof why === "string" ? why.replace(/\s+/g, " ").trim().slice(0, MAX_DOUBLE_WHY) : "", sure: sure === true });
    if (out.length === MAX_DOUBLES) break;
  }
  return out;
}
