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
  perspective: "published",
});
