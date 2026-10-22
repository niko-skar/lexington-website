"use server";

import {
  ASSET_RE,
  MAX_PHOTOS,
  REPORT_RE,
  draftProgressWords,
  publishProgress,
  type ProgressDraft,
  type PublishResult,
} from "@/lib/agents/progress";
import { getAdminSession } from "@/lib/auth/session";

// The progress reporter's two steps: "Write the update" and "Publish". Each checks
// for itself that the admin is signed in (a Server Action can be called directly).

const clean = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);

export async function draftProgressAction(input: {
  assetIds: string[];
  note: string;
  stage: string;
}): Promise<{ ok: true; draft: ProgressDraft } | { ok: false; error: string }> {
  if (!(await getAdminSession())) return { ok: false, error: "Please sign in again." };
  const assetIds = (Array.isArray(input.assetIds) ? input.assetIds : []).filter((id) => ASSET_RE.test(id)).slice(0, MAX_PHOTOS);
  if (!assetIds.length) return { ok: false, error: "Add at least one photo." };
  const draft = await draftProgressWords({ assetIds, note: clean(input.note, 1000), stage: clean(input.stage, 60) });
  return { ok: true, draft };
}

export async function publishProgressAction(input: {
  reportId: string;
  photos: Array<{ assetId: string; alt: string }>;
  title: string;
  text: string;
  stage: string;
  targets: { website: boolean; facebook: boolean; instagram: boolean };
}): Promise<{ ok: true; result: PublishResult } | { ok: false; error: string }> {
  if (!(await getAdminSession())) return { ok: false, error: "Please sign in again." };
  if (!REPORT_RE.test(String(input.reportId))) return { ok: false, error: "Bad request." };
  const photos = (Array.isArray(input.photos) ? input.photos : [])
    .filter((p) => ASSET_RE.test(String(p?.assetId)))
    .slice(0, MAX_PHOTOS)
    .map((p) => ({ assetId: p.assetId, alt: clean(p.alt, 160) || "Photo from The Lexington building site" }));
  const title = clean(input.title, 90).replace(/[.!]+$/, "");
  const text = clean(input.text, 600);
  const stage = clean(input.stage, 60);
  if (!photos.length) return { ok: false, error: "Add at least one photo." };
  if (!title || !text) return { ok: false, error: "The title and the text can't be empty." };
  if (!stage) return { ok: false, error: "Choose the construction stage." };
  const targets = {
    website: Boolean(input.targets?.website),
    facebook: Boolean(input.targets?.facebook),
    instagram: Boolean(input.targets?.instagram),
  };
  if (!targets.website && !targets.facebook && !targets.instagram) return { ok: false, error: "Choose at least one place to post." };
  const result = await publishProgress({ reportId: input.reportId, photos, title, text, stage, targets });
  return { ok: true, result };
}
