/**
 * The progress reporter's words, without the plumbing: what Claude is told about
 * the site photos, the plain version used without Claude, the Facebook and
 * Instagram captions (in the same shape as the daily posts), and the check that
 * keeps a caption from claiming more than Niko said. Pure, so it can be tested.
 */
import { SITE_URL } from "@/lib/seo";

export interface ProgressWords {
  title: string;
  text: string;
  /** One per photo, in order. */
  alts: string[];
}

export const PROGRESS_SYSTEM = `You write short construction updates for The Lexington, a residential building going up in Shiashie, East Legon, Accra. The owner has just taken these photos on site. Your words go on the website's Construction Progress page and on Facebook and Instagram, after the owner has read them.

THE FACTS ARE ONLY WHAT YOU SEE AND WHAT THE OWNER SAYS
- Describe only what is plainly visible, in everyday builder's words (formwork, steel reinforcement, concrete columns, a slab being poured, blockwork, scaffolding, workers fixing...).
- Never state a floor number, a date, a percentage, a milestone ("completed", "topped out", "finished"), a schedule ("on time", "ahead of schedule") or anything about the future, unless the owner's note says it. Use the owner's words for what was done.
- If you are not sure what something in a photo is, leave it out.
- Never name the developer company. No hype (no "luxury", "stunning", "iconic", "dream"), no emojis, no hashtags.

WHAT TO WRITE
- title: at most 8 words, no full stop at the end, e.g. "Columns rising on the second floor".
- text: one to three short sentences (at most 60 words) saying what is happening on site now.
- alts: one short plain description per photo, in the order given (at most 120 characters each), for people who can't see the pictures.`;

export const PROGRESS_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    text: { type: "string" },
    alts: { type: "array", items: { type: "string" } },
  },
  required: ["title", "text", "alts"],
  additionalProperties: false,
} as const;

export function progressPrompt(opts: { note: string; stage: string; count: number; lastStage?: string }): string {
  return [
    `There are ${opts.count} photo${opts.count === 1 ? "" : "s"} above, in order.`,
    opts.stage ? `The owner filed them under the construction stage: "${opts.stage}".` : "",
    opts.lastStage && opts.lastStage !== opts.stage ? `(The previous update on the website was filed under "${opts.lastStage}".)` : "",
    opts.note ? `The owner's note:\n"""\n${opts.note}\n"""` : "The owner left no note: describe only what the photos plainly show.",
    "Write the update.",
  ]
    .filter(Boolean)
    .join("\n");
}

const firstSentence = (text: string) => (text.split(/(?<=[.!?])\s+/)[0] ?? text).replace(/[.!?]+$/, "").trim();

/** The plain version, when Claude isn't connected: Niko's own note, or a neutral line. */
export function templateProgress(opts: { note: string; stage: string; count: number }): ProgressWords {
  const note = opts.note.trim();
  const stage = opts.stage.trim();
  const title = note ? firstSentence(note).slice(0, 70) : stage ? `${stage}: new photos from site` : "New photos from site";
  const text = note || "New photos from the building site in Shiashie, East Legon.";
  const label = note ? firstSentence(note).slice(0, 90) : stage || "The Lexington building site";
  const alts = Array.from({ length: opts.count }, (_, i) => `${label}, photo ${i + 1} of ${opts.count}`);
  return { title, text, alts };
}

// Words a caption must not use unless Niko's note does: they claim a stage, a date or a promise.
const CLAIMS: Array<[RegExp, string]> = [
  [/\b(?:complete[ds]?|completion|finished)\b/i, "says something is complete or finished"],
  [/topp(?:ed|ing)\s+out/i, "says the building is topped out"],
  [/on\s+(?:time|schedule|track)|ahead\s+of\s+schedule|behind\s+schedule/i, "talks about the schedule"],
  [/\b\d+\s?%/, "gives a percentage"],
  [/\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|1st|2nd|3rd|4th|5th|6th|7th|8th|ground|top|roof)\s+(?:floor|storey|story|level|slab)\b/i, "names a floor"],
  [/\b(?:20\d{2}|january|february|march|april|june|july|august|september|october|november|december)\b/i, "mentions a date"],
  [/\b(?:handover|hand\s+over|move\s+in|keys)\b/i, "talks about handover or moving in"],
  [/skarlatos|olympian/i, "names the developer company"],
];

/** What in the words claims more than the note says, in plain words. Empty when nothing. */
export function checkProgressWords(words: ProgressWords, note: string, stage: string): string[] {
  const said = `${note}\n${stage}`;
  const found: string[] = [];
  const all = [words.title, words.text, ...words.alts].join("\n");
  for (const [pattern, what] of CLAIMS) {
    const match = all.match(pattern);
    // Fine when Niko's own note (or the stage he chose) says the same thing.
    if (match && !new RegExp(match[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(said)) {
      found.push(`The text ${what} ("${match[0]}"), which your note doesn't: check it.`);
    }
  }
  return found;
}

const PLACE = "📍 Shiashie, East Legon, Accra";
const HASHTAGS = "#TheLexingtonGH #EastLegon #Shiashie #Accra #GhanaRealEstate #ConstructionProgress #BuildingGhana #UnderConstruction";

const sentence = (title: string) => (/[.!?]$/.test(title.trim()) ? title.trim() : `${title.trim()}.`);

/** The Facebook caption: the same shape as the daily posts, with a tracked link to the progress page. */
export function facebookCaption(words: Pick<ProgressWords, "title" | "text">, reportId: string): string {
  const link = `${SITE_URL}/progress?utm_source=facebook&utm_medium=organic_social&utm_campaign=site_update&utm_content=${reportId}`;
  return [sentence(words.title), words.text.trim(), `Progress page: ${link}`, PLACE, "Photos from the site."].join("\n\n");
}

/** The Instagram caption (links don't work there, so "link in bio"), with the usual hashtags. */
export function instagramCaption(words: Pick<ProgressWords, "title" | "text">): string {
  return [sentence(words.title), words.text.trim(), "Progress page: link in bio (lexington.com.gh/progress)", PLACE, "Photos from the site.", HASHTAGS].join(
    "\n\n"
  );
}
