import { randomBytes } from "node:crypto";

import { getAdminSession } from "@/lib/auth/session";
import { client } from "@/lib/sanity/client";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// The phone shrinks each photo before sending it (lib: components/progress/ProgressReporter.tsx),
// so a real one is well under this; Vercel refuses anything over 4.5 MB anyway.
const MAX_BYTES = 4_400_000;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * POST /api/admin/progress/upload: one site photo from the progress reporter, into the
 * website's image store (where the progress page and Meta fetch it from). Admin only.
 * The photo is not shown anywhere until the update is published.
 */
export async function POST(request: Request): Promise<Response> {
  if (!(await getAdminSession())) return Response.json({ error: "Please sign in again." }, { status: 401 });

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("photo");
  } catch {
    return Response.json({ error: "No photo was sent." }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) return Response.json({ error: "No photo was sent." }, { status: 400 });
  if (!TYPES.includes(file.type)) return Response.json({ error: "That file is not a JPEG, PNG or WebP photo." }, { status: 415 });
  if (file.size > MAX_BYTES) return Response.json({ error: "That photo is too big (over 4 MB)." }, { status: 413 });

  try {
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const asset = await client.assets.upload("image", Buffer.from(await file.arrayBuffer()), {
      filename: `site-${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString("hex")}.${ext}`,
      contentType: file.type,
    });
    return Response.json({
      assetId: asset._id,
      url: asset.url,
      width: asset.metadata?.dimensions?.width ?? null,
      height: asset.metadata?.dimensions?.height ?? null,
    });
  } catch (error) {
    console.error("[progress] photo upload failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "The photo could not be stored. Please try again." }, { status: 502 });
  }
}
