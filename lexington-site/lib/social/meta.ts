// Facebook Page + Instagram publishing through the Graph API (the same route as scripts/post-to-meta.ts, extended to
// swipe-through posts). Both platforms fetch the pictures themselves from public URLs, so nothing is uploaded from here.

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v23.0"}`;

export class MetaError extends Error {
  code?: number;
  subcode?: number;
  constructor(message: string, code?: number, subcode?: number) {
    super(message);
    this.code = code;
    this.subcode = subcode;
  }
  /** the saved login was cancelled by Facebook (password change, permissions removed...) */
  get tokenDead() {
    return this.code === 190 || this.code === 102;
  }
}

export interface MetaEnv {
  pageId: string;
  pageToken: string;
  igUserId?: string;
}

export function metaEnv(): MetaEnv {
  const pageId = process.env.META_PAGE_ID;
  const pageToken = process.env.META_PAGE_TOKEN;
  if (!pageId || !pageToken) throw new Error("META_PAGE_ID / META_PAGE_TOKEN are not set.");
  return { pageId, pageToken, igUserId: process.env.META_IG_USER_ID };
}

async function graph<T = Record<string, unknown>>(method: "GET" | "POST", path: string, params: Record<string, string>, token: string): Promise<T> {
  const url = new URL(`${GRAPH}/${path}`);
  let res: Response;
  if (method === "GET") {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("access_token", token);
    res = await fetch(url, { cache: "no-store" });
  } else {
    const body = new URLSearchParams({ ...params, access_token: token });
    res = await fetch(url, { method: "POST", body, cache: "no-store" });
  }
  const json = (await res.json()) as { error?: { message: string; code?: number; error_subcode?: number } } & T;
  // The Graph API can answer 200 with an error payload, so the status alone is not enough.
  if (json.error) throw new MetaError(json.error.message, json.error.code, json.error.error_subcode);
  return json;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Names the two accounts the token can reach; throws a MetaError (code 190) if the login is dead. */
export async function describeAccounts(env: MetaEnv): Promise<{ page: string; instagram?: string }> {
  const page = await graph<{ name: string }>("GET", env.pageId, { fields: "name" }, env.pageToken);
  let instagram: string | undefined;
  if (env.igUserId) {
    const ig = await graph<{ username: string }>("GET", env.igUserId, { fields: "username" }, env.pageToken);
    instagram = ig.username;
  }
  return { page: page.name, instagram };
}

// ---------------------------------------------------------------- Facebook
export async function postFacebook(env: MetaEnv, opts: { caption: string; imageUrls: string[]; alts: string[] }): Promise<{ id: string; url: string }> {
  const { caption, imageUrls, alts } = opts;
  if (imageUrls.length === 1) {
    const r = await graph<{ id: string; post_id?: string }>(
      "POST",
      `${env.pageId}/photos`,
      { url: imageUrls[0], caption, alt_text_custom: alts[0] ?? "", published: "true" },
      env.pageToken,
    );
    const id = r.post_id || r.id;
    return { id, url: `https://www.facebook.com/${id}` };
  }
  // several pictures: upload each unpublished, then publish one post that carries them all
  const uploaded = await Promise.all(
    imageUrls.map((url, i) => graph<{ id: string }>("POST", `${env.pageId}/photos`, { url, published: "false", alt_text_custom: alts[i] ?? "" }, env.pageToken)),
  );
  const params: Record<string, string> = { message: caption };
  uploaded.forEach((u, i) => {
    params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: u.id });
  });
  const post = await graph<{ id: string }>("POST", `${env.pageId}/feed`, params, env.pageToken);
  return { id: post.id, url: `https://www.facebook.com/${post.id}` };
}

// ---------------------------------------------------------------- Instagram
async function waitForContainer(id: string, token: string, tries = 45) {
  for (let i = 0; i < tries; i++) {
    const r = await graph<{ status_code?: string; status?: string }>("GET", id, { fields: "status_code,status" }, token);
    if (r.status_code === "FINISHED") return;
    if (r.status_code === "ERROR" || r.status_code === "EXPIRED") throw new MetaError(`Instagram rejected the picture: ${r.status || r.status_code}`);
    await sleep(2000);
  }
  throw new MetaError("Instagram did not finish processing the picture in time.");
}

async function createContainer(env: MetaEnv, params: Record<string, string>, alt?: string) {
  try {
    return await graph<{ id: string }>("POST", `${env.igUserId}/media`, alt ? { ...params, alt_text: alt.slice(0, 1000) } : params, env.pageToken);
  } catch (e) {
    // alt text is a nice-to-have: if Instagram refuses the field, post without it rather than not at all
    if (alt && e instanceof MetaError && !e.tokenDead && /alt_text|param/i.test(e.message)) {
      return graph<{ id: string }>("POST", `${env.igUserId}/media`, params, env.pageToken);
    }
    throw e;
  }
}

export async function postInstagram(env: MetaEnv, opts: { caption: string; imageUrls: string[]; alts: string[] }): Promise<{ id: string; url: string }> {
  if (!env.igUserId) throw new Error("META_IG_USER_ID is not set.");
  const { caption, imageUrls, alts } = opts;
  let creation: string;
  if (imageUrls.length === 1) {
    const c = await createContainer(env, { image_url: imageUrls[0], caption }, alts[0]);
    await waitForContainer(c.id, env.pageToken);
    creation = c.id;
  } else {
    const children = await Promise.all(imageUrls.map((url, i) => createContainer(env, { image_url: url, is_carousel_item: "true" }, alts[i])));
    await Promise.all(children.map((c) => waitForContainer(c.id, env.pageToken)));
    const parent = await graph<{ id: string }>(
      "POST",
      `${env.igUserId}/media`,
      { media_type: "CAROUSEL", children: children.map((c) => c.id).join(","), caption },
      env.pageToken,
    );
    await waitForContainer(parent.id, env.pageToken);
    creation = parent.id;
  }
  const published = await graph<{ id: string }>("POST", `${env.igUserId}/media_publish`, { creation_id: creation }, env.pageToken);
  let url = "";
  try {
    url = (await graph<{ permalink?: string }>("GET", published.id, { fields: "permalink" }, env.pageToken)).permalink || "";
  } catch {
    /* the post is live either way */
  }
  return { id: published.id, url };
}
