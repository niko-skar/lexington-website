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
  const userToken = process.argv[2];
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;

  if (!userToken) {
    console.error("Usage: npm run meta:setup -- <user-token>");
    process.exit(1);
  }

  // The app secret is only needed to trade a short-lived token for a long-lived
  // one. Revealing it requires a password prompt, so the simpler route is to
  // extend the token in Meta's Access Token Debugger and pass the result here —
  // in which case there's nothing left to exchange.
  let longToken = userToken;
  if (appId && appSecret) {
    console.log("Exchanging for a long-lived user token…");
    ({ access_token: longToken } = await graph<{ access_token: string }>("oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: userToken,
    }));
  } else {
    console.log("No app secret set — assuming the token is already long-lived.");
  }

  // Page tokens inherit the lifetime of the user token they were read from, so
  // a short-lived one here means everything downstream dies in about an hour.
  const { data: info } = await graph<{ data: { expires_at?: number } }>("debug_token", {
    input_token: longToken,
    access_token: longToken,
  });

  if (info.expires_at === 0 || info.expires_at === undefined) {
    console.log("Token does not expire — Page tokens from it will be permanent.\n");
  } else {
    const hours = Math.round((info.expires_at * 1000 - Date.now()) / 3_600_000);
    console.log(`WARNING: this token expires in ~${hours}h, and the Page tokens below will too.`);
    console.log("Extend it first at developers.facebook.com/tools/debug/accesstoken\n");
  }

  console.log("Reading Pages and linked Instagram accounts…\n");
  const { data: pages } = await graph<{ data: PageAccount[] }>("me/accounts", {
    fields: "id,name,access_token,instagram_business_account{id,username}",
    access_token: longToken,
  });

  if (!pages.length) {
    console.error("No Pages found. Check the token was granted pages_show_list.");
    process.exit(1);
  }

  // Page tokens are long-lived and can publish as the business, so --write
  // appends them straight to .env.local and prints only a masked confirmation,
  // keeping the secret out of terminal scrollback and logs.
  const write = process.argv.includes("--write");
  const mask = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)} (${s.length} chars)`;

  for (const page of pages) {
    const ig = page.instagram_business_account;
    console.log(`── ${page.name} ──`);
    console.log(`META_PAGE_ID=${page.id}`);
    console.log(`META_PAGE_TOKEN=${write ? mask(page.access_token) : page.access_token}`);
    if (ig) {
      console.log(`META_IG_USER_ID=${ig.id}${ig.username ? `   # @${ig.username}` : ""}`);
    } else {
      console.log("# No Instagram business account linked to this Page.");
      console.log("# Link it in Meta Business Suite → Settings → Instagram accounts.");
    }
    console.log("");
  }

  if (write) {
    const { appendFileSync } = await import("node:fs");
    const page = pages[0];
    const lines = [
      "",
      `# Meta posting — added by meta-setup on ${new Date().toISOString().slice(0, 10)}`,
      `META_PAGE_ID=${page.id}`,
      `META_PAGE_TOKEN=${page.access_token}`,
      ...(page.instagram_business_account
        ? [`META_IG_USER_ID=${page.instagram_business_account.id}`]
        : []),
      "",
    ].join("\n");

    appendFileSync(".env.local", lines);
    console.log(`Appended ${page.name} credentials to .env.local`);
    console.log("Verify with: npm run meta:post -- --check\n");
  } else {
    console.log("Copy the block above into .env.local, or re-run with --write to");
    console.log("append it automatically without printing the token.\n");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
