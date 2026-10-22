import "server-only";
import { createClient } from "next-sanity";

import { apiVersion, dataset, projectId } from "@/sanity/env";

export const client = createClient({
  projectId,
  dataset,
  apiVersion,
  token: process.env.SANITY_API_TOKEN,
  useCdn: false,
  // Without this, a token-authenticated client returns draft documents
  // alongside published ones — any unpublished edit in Studio (even a
  // half-finished draft with missing fields) would leak onto the live
  // public site.
  // The one exception is a test copy on a computer (never a deployment):
  // SANITY_LOCAL_DRAFTS=1 shows drafts, so the progress reporter can be tried
  // end to end without a test update ever reaching the live site.
  perspective:
    !process.env.VERCEL_ENV && process.env.NODE_ENV !== "production" && process.env.SANITY_LOCAL_DRAFTS === "1"
      ? "drafts"
      : "published",
});
