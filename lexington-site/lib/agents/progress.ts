import "server-only";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { claudeConfigured, writeWithClaude } from "@/lib/ai/claude";
import { todayISO } from "@/lib/crm";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { client } from "@/lib/sanity/client";
import { urlFor } from "@/lib/sanity/image";
import { MetaError, metaEnv, postFacebook, postInstagram } from "@/lib/social/meta";
import type { PlatformResult } from "@/lib/social/types";

import {
  PROGRESS_SCHEMA,
  PROGRESS_SYSTEM,
  checkProgressWords,
  facebookCaption,
  instagramCaption,
  progressPrompt,
  templateProgress,
  type ProgressWords,
} from "./progressCore";

/**
 * THE PROGRESS REPORTER. From Niko's phone (/admin/progress): he picks site photos
 * and, if he likes, writes a line about what's new. The photos go up to the
 * website's image store straight away; Claude looks at them and writes a title,
 * a few words and a description of each photo (or his own line is used when
 * Claude isn't connected). He reads it, changes anything, and presses Publish:
 * the update goes to the top of the Construction Progress page and into its
 * gallery, and out on Facebook and Instagram.
 *
 * Publishing is safe to press twice: each part remembers it is done (a private
 * `progressPost.<id>` record) and is not repeated.
 */

const newKey = () => randomUUID().replace(/-/g, "").slice(0, 12);
export const ASSET_RE = /^image-[a-f0-9]{20,64}-\d{1,5}x\d{1,5}-(?:jpg|jpeg|png|webp)$/;
export const REPORT_RE = /^[a-z0-9]{6,20}$/;
export const MAX_PHOTOS = 10;

const imageOf = (assetId: string) => ({ _type: "image" as const, asset: { _type: "reference" as const, _ref: assetId } });

/** A size Claude can look at without costing much. */
const lookUrl = (assetId: string) => urlFor(imageOf(assetId)).width(1280).format("jpg").quality(80).url();
/** Facebook takes the photo as it is. */
const facebookUrl = (assetId: string) => urlFor(imageOf(assetId)).width(2048).format("jpg").quality(85).url();
/** Instagram only takes shapes from 4:5 to 1.91:1, so phone photos are cropped to 4:5 (a swipe-through post shares one shape). */
const instagramUrl = (assetId: string) => urlFor(imageOf(assetId)).width(1080).height(1350).fit("crop").format("jpg").quality(85).url();

// Testing on a computer (never on the live site): the website part is written as Studio drafts,
// which the public site never shows, so a test update can't appear on the live progress page.
const asDraft = () => !process.env.VERCEL_ENV && process.env.NODE_ENV !== "production" && process.env.PROGRESS_WRITE_DRAFTS === "1";
const docId = (id: string) => (asDraft() ? `drafts.${id}` : id);

export interface ProgressDraft extends ProgressWords {
  writer: "claude" | "template";
  warnings: string[];
  /** Why Claude did not write it, when it didn't. */
  note?: string;
}

/** The words for a new update, from the photos and Niko's note. Never throws. */
export async function draftProgressWords(opts: { assetIds: string[]; note: string; stage: string }): Promise<ProgressDraft> {
  const count = opts.assetIds.length;
  let lastStage: string | undefined;
  try {
    lastStage = (await client.fetch<string | null>(`*[_type == "constructionUpdate"] | order(order desc)[0].stage`)) ?? undefined;
  } catch {
    /* only a hint for Claude */
  }

  let words: ProgressWords | null = null;
  let note: string | undefined;
  if (claudeConfigured()) {
    const result = await writeWithClaude<ProgressWords>({
      system: PROGRESS_SYSTEM,
      content: [
        ...opts.assetIds.map((id) => ({ type: "image" as const, source: { type: "url" as const, url: lookUrl(id) } })),
        { type: "text", text: progressPrompt({ note: opts.note, stage: opts.stage, count, lastStage }) },
      ],
      schema: PROGRESS_SCHEMA,
      effort: "low",
      purpose: "progress update",
    });
    if (result.ok && result.value.title.trim() && result.value.text.trim()) {
      const v = result.value;
      const fallback = templateProgress({ note: opts.note, stage: opts.stage, count }).alts;
      words = {
        title: v.title.trim().replace(/[.!]+$/, "").slice(0, 90),
        text: v.text.trim().slice(0, 600),
        // One description per photo, whatever came back.
        alts: fallback.map((alt, i) => v.alts[i]?.trim().slice(0, 160) || alt),
      };
    } else if (!result.ok) {
      note = `Claude couldn't write this one (${result.error.replace(/\.$/, "")}), so this is your note as it is.`;
    }
  }

  const final = words ?? templateProgress({ note: opts.note, stage: opts.stage, count });
  return {
    ...final,
    writer: words ? "claude" : "template",
    warnings: checkProgressWords(final, opts.note, opts.stage),
    ...(note && { note }),
  };
}

export interface PublishInput {
  reportId: string;
  photos: Array<{ assetId: string; alt: string }>;
  title: string;
  text: string;
  stage: string;
  targets: { website: boolean; facebook: boolean; instagram: boolean };
}

interface ProgressLog {
  _id: string;
  _type: "progressPost";
  reportId: string;
  website?: PlatformResult;
  fb?: PlatformResult;
  ig?: PlatformResult;
}

export interface PublishResult {
  website?: PlatformResult;
  fb?: PlatformResult;
  ig?: PlatformResult;
  /** Problems in plain words, one per place that failed. */
  problems: string[];
}

/** Puts the update on the website, Facebook and Instagram (each only once). Never throws. */
export async function publishProgress(input: PublishInput): Promise<PublishResult> {
  const buyers = getBuyersClient();
  const logId = process.env.VERCEL_ENV === "production" ? `progressPost.${input.reportId}` : `progressPost.dev-${input.reportId}`;
  const log: ProgressLog = (await buyers.getDocument<ProgressLog>(logId).catch(() => null)) ?? {
    _id: logId,
    _type: "progressPost",
    reportId: input.reportId,
  };
  const problems: string[] = [];
  const reportDocId = docId(`progress-report-${input.reportId}`);
  const now = () => new Date().toISOString();

  // ---- 1. the website: the update at the top of /progress, and each photo in its gallery
  if (input.targets.website && !log.website?.ok) {
    try {
      const lastOrder = (await client.fetch<number | null>(`*[_type == "constructionUpdate"] | order(order desc)[0].order`)) ?? 0;
      let tx = client.transaction();
      input.photos.forEach((p, i) => {
        tx = tx.createOrReplace({
          _id: docId(`construction-progress-${input.reportId}-${i + 1}`),
          _type: "constructionUpdate",
          image: imageOf(p.assetId),
          alt: p.alt,
          stage: input.stage,
          order: lastOrder + 1 + i,
        });
      });
      tx = tx.createOrReplace({
        _id: reportDocId,
        _type: "progressReport",
        date: todayISO(),
        title: input.title,
        text: input.text,
        stage: input.stage,
        photos: input.photos.map((p) => ({ _key: newKey(), image: imageOf(p.assetId), alt: p.alt })),
      });
      await tx.commit();
      log.website = { ok: true, at: now(), attempts: (log.website?.attempts ?? 0) + 1 };
      revalidatePath("/progress");
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      log.website = { ok: false, error: message, attempts: (log.website?.attempts ?? 0) + 1 };
      problems.push(`Website: ${message}`);
    }
  }

  // ---- 2. Facebook and Instagram, one after the other; one failing never stops the other
  const alts = input.photos.map((p) => p.alt);
  for (const platform of ["fb", "ig"] as const) {
    const wanted = platform === "fb" ? input.targets.facebook : input.targets.instagram;
    if (!wanted || log[platform]?.ok) continue;
    const attempts = (log[platform]?.attempts ?? 0) + 1;
    try {
      const env = metaEnv();
      const posted =
        platform === "fb"
          ? await postFacebook(env, {
              caption: facebookCaption(input, input.reportId),
              imageUrls: input.photos.map((p) => facebookUrl(p.assetId)),
              alts,
            })
          : await postInstagram(env, {
              caption: instagramCaption(input),
              imageUrls: input.photos.map((p) => instagramUrl(p.assetId)),
              alts,
            });
      log[platform] = { ok: true, id: posted.id, url: posted.url, at: now(), attempts };
    } catch (error) {
      const message =
        error instanceof MetaError && error.tokenDead
          ? "Facebook has cancelled the saved login: tell Claude \"reconnect Facebook\"."
          : error instanceof Error
            ? error.message
            : "unknown error";
      log[platform] = { ok: false, error: message, attempts };
      problems.push(`${platform === "fb" ? "Facebook" : "Instagram"}: ${message}`);
    }
  }

  await buyers.createOrReplace(log).catch((e) => console.error("[progress] could not save the record:", e));
  // The links to the posts, on the website's record of the update.
  if (log.website?.ok && (log.fb?.url || log.ig?.url)) {
    await client
      .patch(reportDocId)
      .set({ ...(log.fb?.url && { facebookUrl: log.fb.url }), ...(log.ig?.url && { instagramUrl: log.ig.url }) })
      .commit()
      .catch(() => undefined);
  }
  return { website: log.website, fb: log.fb, ig: log.ig, problems };
}

export interface RecentUpdate {
  _id: string;
  date: string;
  title: string;
  photos: number;
  thumb?: string;
  facebookUrl?: string;
  instagramUrl?: string;
}

/** The last few updates, for the list under the form. */
export async function recentUpdates(limit = 6): Promise<RecentUpdate[]> {
  try {
    const rows = await client.fetch<Array<{ _id: string; date: string; title: string; photos?: Array<{ image: { asset?: { _ref: string } } }>; facebookUrl?: string; instagramUrl?: string }>>(
      `*[_type == "progressReport"] | order(date desc, _createdAt desc)[0...$limit]{ _id, date, title, photos[]{ image }, facebookUrl, instagramUrl }`,
      { limit },
      { cache: "no-store" }
    );
    return rows.map((r) => {
      const first = r.photos?.[0]?.image?.asset?._ref;
      return {
        _id: r._id,
        date: r.date,
        title: r.title,
        photos: r.photos?.length ?? 0,
        thumb: first ? urlFor(imageOf(first)).width(240).height(240).fit("crop").format("jpg").url() : undefined,
        facebookUrl: r.facebookUrl,
        instagramUrl: r.instagramUrl,
      };
    });
  } catch {
    return [];
  }
}

/** The stage names already used, newest first (the form's suggestions). */
export async function knownStages(): Promise<string[]> {
  try {
    const rows = await client.fetch<Array<{ stage?: string }>>(`*[_type == "constructionUpdate"] | order(order desc){ stage }`, {}, { cache: "no-store" });
    return [...new Set(rows.map((r) => r.stage?.trim()).filter((s): s is string => Boolean(s)))];
  } catch {
    return [];
  }
}
