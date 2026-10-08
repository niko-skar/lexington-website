import { SITE_URL } from "@/lib/seo";

import { calendar, postForDate } from "./calendar";
import { runChecks } from "./checks";
import { MetaError, metaEnv, postFacebook, postInstagram, type MetaEnv } from "./meta";
import { sendNotice } from "./notify";
import { logId, readLog, saveLog } from "./state";
import type { Platform, PlatformResult, SocialLog, SocialPost } from "./types";

export interface RunOptions {
  /** the day to post (UTC, YYYY-MM-DD); today when left out */
  date?: string;
  /** do everything except publish */
  dryRun?: boolean;
  /** only these platforms */
  only?: Platform[];
  /** ignore the pause switch, the retry limit and a "held" day */
  force?: boolean;
  /** skip the live fact check (never used by the cron) */
  skipChecks?: boolean;
  log?: (message: string) => void;
}

export type Outcome = "no-post" | "paused" | "already-done" | "held" | "dry-run" | "posted" | "partial" | "failed";

export interface RunResult {
  date: string;
  post?: string;
  title?: string;
  outcome: Outcome;
  detail?: string[];
  fb?: PlatformResult;
  ig?: PlatformResult;
}

const MAX_ATTEMPTS = 3;
const NAME: Record<Platform, string> = { fb: "Facebook", ig: "Instagram" };

// Meta fetches each picture itself, so first make sure every one is really there and really a JPEG.
async function missingPictures(post: SocialPost): Promise<string[]> {
  const bad: string[] = [];
  await Promise.all(
    post.images.map(async (file) => {
      try {
        const res = await fetch(`${SITE_URL}/social/${file}`, { method: "HEAD", cache: "no-store" });
        if (!res.ok || !(res.headers.get("content-type") || "").includes("image/jpeg")) bad.push(`${file} (${res.status})`);
      } catch {
        bad.push(`${file} (unreachable)`);
      }
    }),
  );
  return bad;
}

export async function runDaily(opts: RunOptions = {}): Promise<RunResult> {
  const log = opts.log ?? (() => {});
  const date = opts.date ?? new Date().toISOString().slice(0, 10);

  if (process.env.SOCIAL_PAUSED === "1" && !opts.force) return { date, outcome: "paused", detail: ["SOCIAL_PAUSED is set."] };

  const post = postForDate(date);
  if (!post) return { date, outcome: "no-post", detail: [`Nothing is scheduled for ${date} (the calendar runs ${calendar.posts[0].date} to ${calendar.posts[calendar.posts.length - 1].date}).`] };
  const base = { date, post: post.id, title: post.title };

  const platforms: Platform[] = opts.only?.length ? opts.only : ["fb", "ig"];
  const prior = opts.dryRun ? null : await readLog(date);
  const todo = platforms.filter((p) => !prior?.[p]?.ok);
  if (!todo.length) return { ...base, outcome: "already-done", detail: ["Everything for this day has already gone out."], fb: prior?.fb, ig: prior?.ig };

  // 1. the facts still hold?
  if (!opts.skipChecks) {
    log(`checking ${post.checks.length} facts…`);
    const failed = await runChecks(post.checks);
    if (failed.length) {
      log("held back: " + failed.join(" | "));
      if (!opts.dryRun) {
        const entry: SocialLog = { ...(prior ?? { _id: logId(date), _type: "socialLog", date, post: post.id }), status: "held", heldReasons: failed, noticeSent: true };
        await saveLog(entry);
        if (!prior?.noticeSent) {
          await sendNotice(`Lexington post held back: ${post.title}`, [
            `Today's post ("${post.title}", ${date}) was NOT published, because something it quotes has changed on the website:`,
            ...failed.map((f) => "• " + f),
            "Tell Claude and it will be updated. Nothing else is affected: tomorrow's post goes out as normal.",
          ]);
        }
      }
      return { ...base, outcome: "held", detail: failed };
    }
  }

  // 2. the pictures are reachable?
  const imageUrls = post.images.map((f) => `${SITE_URL}/social/${f}`);
  const missing = await missingPictures(post);
  if (missing.length && opts.dryRun) log(`warning: ${missing.length} picture(s) are not on the website yet (a rehearsal before the first deploy is expected to say this)`);
  else if (missing.length) {
    const detail = [`Pictures not reachable on the website yet: ${missing.join(", ")}`];
    log(detail[0]);
    if (!opts.force) {
      await saveLog({ ...(prior ?? { _id: logId(date), _type: "socialLog", date, post: post.id }), status: "failed", heldReasons: detail });
      await sendNotice(`Lexington post could not go out: ${post.title}`, [`The pictures for today's post are not on the website: ${missing.join(", ")}.`, "The next scheduled run will try again."]);
    }
    return { ...base, outcome: "failed", detail };
  }

  if (opts.dryRun) {
    log(`dry run: would post "${post.title}" to ${todo.map((p) => NAME[p]).join(" and ")} with ${imageUrls.length} picture(s)`);
    return { ...base, outcome: "dry-run", detail: [`${post.title}: ${imageUrls.length} picture(s) to ${todo.map((p) => NAME[p]).join(" and ")}`, ...imageUrls] };
  }

  // 3. publish, one platform at a time; one failing never stops the other
  const env: MetaEnv = metaEnv();
  const results: Partial<Record<Platform, PlatformResult>> = { fb: prior?.fb, ig: prior?.ig };
  const problems: string[] = [];
  let tokenDead = false;
  for (const p of todo) {
    const attempts = (prior?.[p]?.attempts ?? 0) + 1;
    if (attempts > MAX_ATTEMPTS && !opts.force) {
      problems.push(`${NAME[p]}: gave up after ${MAX_ATTEMPTS} tries (${prior?.[p]?.error})`);
      continue;
    }
    try {
      log(`posting to ${NAME[p]}…`);
      const r = p === "fb"
        ? await postFacebook(env, { caption: post.fb, imageUrls, alts: post.alt })
        : await postInstagram(env, { caption: post.ig, imageUrls, alts: post.alt });
      results[p] = { ok: true, id: r.id, url: r.url, at: new Date().toISOString(), attempts };
      log(`${NAME[p]} done: ${r.url || r.id}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (e instanceof MetaError && e.tokenDead) tokenDead = true;
      results[p] = { ok: false, error: message, attempts };
      problems.push(`${NAME[p]}: ${message}`);
      log(`${NAME[p]} failed: ${message}`);
    }
  }

  const okCount = platforms.filter((p) => results[p]?.ok).length;
  const status: SocialLog["status"] = okCount === platforms.length ? "posted" : okCount > 0 ? "partial" : "failed";
  const entry: SocialLog = { ...(prior ?? { _id: logId(date), _type: "socialLog", date, post: post.id }), status, fb: results.fb, ig: results.ig, heldReasons: undefined };
  await saveLog(entry);

  // 4. tell the owner what matters
  if (tokenDead) {
    await sendNotice("Lexington posting: Facebook needs reconnecting", [
      "Facebook has cancelled the saved login the daily posts use (this happens when the Facebook password is changed).",
      `Today's post ("${post.title}") did not go out. Tell Claude: "reconnect Facebook" and it will be fixed.`,
    ]);
  } else if (problems.length) {
    await sendNotice(`Lexington post problem: ${post.title}`, [`Today's post ("${post.title}") hit a problem:`, ...problems.map((x) => "• " + x), "It will try again at the next scheduled run."]);
  } else if (process.env.SOCIAL_NOTIFY_OK !== "0") {
    await sendNotice(`Posted: ${post.title}`, [
      `Today's post is live: "${post.title}".`,
      ...(results.fb?.url ? [`Facebook: ${results.fb.url}`] : []),
      ...(results.ig?.url ? [`Instagram: ${results.ig.url}`] : []),
    ]);
  }

  return { ...base, outcome: status === "posted" ? "posted" : status === "partial" ? "partial" : "failed", detail: problems, fb: results.fb, ig: results.ig };
}
