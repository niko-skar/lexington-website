import { createClient, type SanityClient } from "@sanity/client";

import type { SocialLog } from "./types";

// What has gone out on which day lives in the PRIVATE dataset (the same one the buyer portal uses), one small document
// per day. It is the only memory the daily run has, so a retry later the same day never posts twice. Nothing here is
// ever read by the public site.

let cached: SanityClient | null = null;

function privateClient(): SanityClient {
  if (cached) return cached;
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
  const dataset = process.env.NEXT_PUBLIC_SANITY_BUYERS_DATASET;
  const token = process.env.SANITY_BUYERS_API_TOKEN;
  if (!projectId || !dataset || !token) {
    throw new Error("Missing NEXT_PUBLIC_SANITY_PROJECT_ID / NEXT_PUBLIC_SANITY_BUYERS_DATASET / SANITY_BUYERS_API_TOKEN.");
  }
  cached = createClient({ projectId, dataset, token, apiVersion: "2024-06-01", useCdn: false });
  return cached;
}

export const logId = (date: string) => `socialLog.${date}`;

export async function readLog(date: string): Promise<SocialLog | null> {
  return (await privateClient().getDocument<SocialLog>(logId(date))) ?? null;
}

export async function saveLog(log: SocialLog): Promise<void> {
  await privateClient().createOrReplace(log);
}
