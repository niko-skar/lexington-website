/**
 * One-time setup helper for posting to Facebook + Instagram via the Graph API.
 *
 * Graph API Explorer only hands out a short-lived user token (~1 hour). This
 * exchanges it for a long-lived one, then reads the Page tokens off it — Page
 * tokens derived from a long-lived user token don't expire, which is what makes
 * unattended posting possible.
 *
 * Run:  npm run meta:setup -- <short-lived-user-token>
 *
 * Needs META_APP_ID and META_APP_SECRET in .env.local (from your app's
 * Settings → Basic page at developers.facebook.com).
 */

export {}; // keeps this file a module so its top-level names stay scoped to it

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v23.0"}`;

interface PageAccount {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string; username?: string };
}

async function graph<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${GRAPH}/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url);
  const body = await res.json();

  // The Graph API returns 200 with an `error` object in some failure modes, so
  // checking res.ok alone would let errors through silently.
  if (body.error) {
    throw new Error(`Graph API: ${body.error.message} (code ${body.error.code})`);
  }
  return body as T;
}

async function main() {
  const shortToken = process.argv[2];
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;

  if (!shortToken) {
    console.error("Usage: npm run meta:setup -- <short-lived-user-token>");
    process.exit(1);
  }
  if (!appId || !appSecret) {
    console.error("Set META_APP_ID and META_APP_SECRET in .env.local first.");
    process.exit(1);
  }

  console.log("Exchanging for a long-lived user token…");
  const { access_token: longToken } = await graph<{ access_token: string }>("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortToken,
  });

  console.log("Reading Pages and linked Instagram accounts…\n");
  const { data: pages } = await graph<{ data: PageAccount[] }>("me/accounts", {
    fields: "id,name,access_token,instagram_business_account{id,username}",
    access_token: longToken,
  });

  if (!pages.length) {
    console.error("No Pages found. Check the token was granted pages_show_list.");
    process.exit(1);
  }

  for (const page of pages) {
    const ig = page.instagram_business_account;
    console.log(`── ${page.name} ──`);
    console.log(`META_PAGE_ID=${page.id}`);
    console.log(`META_PAGE_TOKEN=${page.access_token}`);
    if (ig) {
      console.log(`META_IG_USER_ID=${ig.id}${ig.username ? `   # @${ig.username}` : ""}`);
    } else {
      console.log("# No Instagram business account linked to this Page.");
      console.log("# Link it in Meta Business Suite → Settings → Instagram accounts.");
    }
    console.log("");
  }

  console.log("Copy the block for The Lexington into .env.local, then verify with:");
  console.log("  npm run meta:post -- --check\n");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
