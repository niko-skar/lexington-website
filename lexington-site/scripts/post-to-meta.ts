/**
 * Publish a photo post to the Facebook Page and/or Instagram in one command.
 *
 *   npm run meta:post -- --image "<url>" --caption "text" --to fb,ig
 *   npm run meta:post -- --latest-progress --caption "On site this week."
 *   npm run meta:post -- --check
 *
 * Both platforms take a publicly reachable image URL rather than a file upload,
 * so Sanity CDN URLs go straight in — no downloading, no multipart.
 */

export {}; // keeps this file a module so its top-level names stay scoped to it

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v23.0"}`;

const PAGE_ID = process.env.META_PAGE_ID;
const PAGE_TOKEN = process.env.META_PAGE_TOKEN;
const IG_USER_ID = process.env.META_IG_USER_ID;

const SANITY_PROJECT = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const SANITY_DATASET = process.env.NEXT_PUBLIC_SANITY_DATASET || "production";

/** Instagram rejects anything outside this range; Facebook is unfussy. */
const IG_MIN_RATIO = 0.8; // 4:5 portrait
const IG_MAX_RATIO = 1.91; // landscape

interface Args {
  image?: string;
  caption?: string;
  to: string[];
  latestProgress: boolean;
  check: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { to: ["fb", "ig"], latestProgress: false, check: false, dryRun: false };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--image":
        args.image = argv[++i];
        break;
      case "--caption":
        args.caption = argv[++i];
        break;
      case "--to":
        args.to = argv[++i].split(",").map((s) => s.trim());
        break;
      case "--latest-progress":
        args.latestProgress = true;
        break;
      case "--check":
        args.check = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
    }
  }
  return args;
}

async function graphPost(path: string, params: Record<string, string>) {
  const body = new URLSearchParams(params);
  const res = await fetch(`${GRAPH}/${path}`, { method: "POST", body });
  const json = await res.json();

  // Graph can return 200 with an `error` payload, so res.ok isn't sufficient.
  if (json.error) {
    throw new Error(`${json.error.message} (code ${json.error.code})`);
  }
  return json;
}

/**
 * Sanity encodes the source dimensions in the asset filename
 * (…-1800x1243.jpg), so the aspect ratio is readable without fetching bytes.
 */
function sourceRatio(url: string): number | null {
  const match = url.match(/-(\d+)x(\d+)\.\w+/);
  if (!match) return null;
  return Number(match[1]) / Number(match[2]);
}

/**
 * Instagram only accepts JPEG within a narrow aspect range, and many of the
 * construction photos are tall phone shots (~0.56) that it would reject. Sanity's
 * CDN can convert and crop on the fly, so fix both here rather than failing at
 * the API and leaving a half-published post.
 */
function normaliseForInstagram(url: string): string {
  const out = new URL(url);
  out.searchParams.set("fm", "jpg");
  if (!out.searchParams.has("w")) out.searchParams.set("w", "1440");

  const ratio = sourceRatio(url);
  if (ratio !== null && (ratio < IG_MIN_RATIO || ratio > IG_MAX_RATIO)) {
    out.searchParams.set("ar", ratio < IG_MIN_RATIO ? "4:5" : "1.91:1");
    out.searchParams.set("fit", "crop");
  }
  return out.toString();
}

async function latestProgressImage(): Promise<{ url: string; alt: string }> {
  if (!SANITY_PROJECT) throw new Error("NEXT_PUBLIC_SANITY_PROJECT_ID is not set.");

  const query = `*[_type == "galleryImage" && category == "progress"]|order(order desc)[0]{alt,"url":image.asset->url}`;
  const endpoint = `https://${SANITY_PROJECT}.api.sanity.io/v2021-10-21/data/query/${SANITY_DATASET}?query=${encodeURIComponent(query)}`;

  const res = await fetch(endpoint);
  const { result } = await res.json();
  if (!result?.url) throw new Error("No progress images found in Sanity.");

  return { url: result.url, alt: result.alt || "" };
}

async function postToFacebook(imageUrl: string, caption: string) {
  const result = await graphPost(`${PAGE_ID}/photos`, {
    url: imageUrl,
    caption,
    access_token: PAGE_TOKEN!,
  });
  return result.post_id || result.id;
}

/** Instagram publishing is two calls: stage a container, then publish it. */
async function postToInstagram(imageUrl: string, caption: string) {
  const container = await graphPost(`${IG_USER_ID}/media`, {
    image_url: normaliseForInstagram(imageUrl),
    caption,
    access_token: PAGE_TOKEN!,
  });

  const published = await graphPost(`${IG_USER_ID}/media_publish`, {
    creation_id: container.id,
    access_token: PAGE_TOKEN!,
  });
  return published.id;
}

async function check() {
  if (!PAGE_ID || !PAGE_TOKEN) {
    console.error("Missing META_PAGE_ID or META_PAGE_TOKEN in .env.local");
    process.exit(1);
  }

  const url = new URL(`${GRAPH}/${PAGE_ID}`);
  url.searchParams.set("fields", "name,followers_count");
  url.searchParams.set("access_token", PAGE_TOKEN);
  const page = await fetch(url).then((r) => r.json());

  if (page.error) throw new Error(page.error.message);
  console.log(`Facebook Page: ${page.name} (${page.followers_count ?? 0} followers)`);

  if (IG_USER_ID) {
    const igUrl = new URL(`${GRAPH}/${IG_USER_ID}`);
    igUrl.searchParams.set("fields", "username,followers_count");
    igUrl.searchParams.set("access_token", PAGE_TOKEN);
    const ig = await fetch(igUrl).then((r) => r.json());
    if (ig.error) throw new Error(`Instagram: ${ig.error.message}`);
    console.log(`Instagram: @${ig.username} (${ig.followers_count ?? 0} followers)`);
  } else {
    console.log("Instagram: not configured (META_IG_USER_ID unset)");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.check) return check();

  let imageUrl = args.image;
  let caption = args.caption;

  if (args.latestProgress) {
    const latest = await latestProgressImage();
    imageUrl = latest.url;
    // The alt text is already a plain-English description of the shot, so it
    // makes a reasonable caption when none is supplied.
    caption = caption || `${latest.alt}\n\nFollow the build at lexington.com.gh/progress`;
    console.log(`Latest progress image: ${latest.alt}`);
  }

  if (!imageUrl) {
    console.error("Provide --image <url> or --latest-progress");
    process.exit(1);
  }
  if (!caption) {
    console.error("Provide --caption \"…\"");
    process.exit(1);
  }
  // Checked before credentials so a dry run works before setup is finished.
  if (args.dryRun) {
    console.log("\n--- dry run, nothing published ---");
    console.log(`Facebook image:  ${imageUrl}`);
    console.log(`Instagram image: ${normaliseForInstagram(imageUrl)}`);
    console.log(`Caption:\n${caption}\n`);
    return;
  }

  if (!PAGE_ID || !PAGE_TOKEN) {
    console.error("Missing META_PAGE_ID or META_PAGE_TOKEN. Run: npm run meta:setup");
    process.exit(1);
  }

  if (args.to.includes("fb")) {
    const id = await postToFacebook(imageUrl, caption);
    console.log(`Facebook posted: https://facebook.com/${id}`);
  }

  if (args.to.includes("ig")) {
    if (!IG_USER_ID) {
      console.warn("Skipping Instagram — META_IG_USER_ID not set.");
    } else {
      const id = await postToInstagram(imageUrl, caption);
      console.log(`Instagram posted: media id ${id}`);
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
