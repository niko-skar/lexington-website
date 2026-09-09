import "server-only";
import { createClient, type SanityClient } from "next-sanity";

// A separate client, token and dataset from lib/sanity/client.ts -- this
// one holds payments and signed legal documents, so it must never touch
// the public "production" dataset (which has no read auth at all) and
// must never be imported by anything the public site renders.
//
// Built lazily inside a function, NOT as a top-level const: Next.js
// evaluates every route module during the build's "collect page data"
// step, so a top-level throw here for a missing env var would fail the
// entire site's build, not just the buyer portal's routes. This way the
// error only surfaces when an /account or /admin request actually runs.
let cached: SanityClient | null = null;

export function getBuyersClient(): SanityClient {
  if (cached) return cached;

  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
  const dataset = process.env.NEXT_PUBLIC_SANITY_BUYERS_DATASET;
  const token = process.env.SANITY_BUYERS_API_TOKEN;

  if (!projectId || !dataset || !token) {
    throw new Error(
      "Missing NEXT_PUBLIC_SANITY_PROJECT_ID / NEXT_PUBLIC_SANITY_BUYERS_DATASET / SANITY_BUYERS_API_TOKEN -- the buyer portal needs its own private dataset and token, set up separately from the public site's."
    );
  }

  cached = createClient({
    projectId,
    dataset,
    token,
    apiVersion: "2024-06-01",
    // Writes (a new payment, a password reset) must be immediately
    // consistent on the next dashboard load, not served from a stale CDN
    // copy -- same reasoning as the public client, but more important
    // here since Niko edits this data directly and expects it to show up.
    useCdn: false,
  });
  return cached;
}
