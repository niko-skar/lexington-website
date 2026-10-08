/**
 * Run the daily post by hand (the Vercel cron runs the same code every day).
 *
 *   npm run social:post -- --check            is the Facebook / Instagram connection alive?
 *   npm run social:post -- --dry-run          today's post: check the facts and the pictures, publish nothing
 *   npm run social:post -- --date 2026-10-09  that day's post (add --dry-run to rehearse it)
 *   npm run social:post -- --only ig          only one platform (fb or ig)
 *   npm run social:post -- --force            ignore the pause switch and the retry limit
 */

import { calendar } from "../lib/social/calendar";
import { describeAccounts, metaEnv } from "../lib/social/meta";
import { runDaily } from "../lib/social/run";
import type { Platform } from "../lib/social/types";

function flag(name: string) {
  return process.argv.includes(`--${name}`);
}
function value(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (flag("check")) {
    const accounts = await describeAccounts(metaEnv());
    console.log(`Connected: Facebook Page "${accounts.page}"${accounts.instagram ? `, Instagram @${accounts.instagram}` : ", Instagram not configured"}.`);
    return;
  }
  if (flag("list")) {
    for (const p of calendar.posts) console.log(p.date, p.id, `${p.images.length} pic`, p.title);
    return;
  }
  const only = value("only") as Platform | undefined;
  const result = await runDaily({
    date: value("date"),
    dryRun: flag("dry-run"),
    only: only ? [only] : undefined,
    force: flag("force"),
    skipChecks: flag("skip-checks"),
    log: (m) => console.log(m),
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
