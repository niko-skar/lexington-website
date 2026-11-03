import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

import { requireTodoUser, TodoError } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/concrete/pour-photo/blob: the phone's leave to upload a pre-pour photo's original, at full size, straight to
 * the private photo store (a website upload stops at 4.5 MB). Only someone signed in to Concrete, only under
 * "pours/<pour>/", only photos.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as HandleUploadBody;
    const answer = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        await requireTodoUser(false, "concrete");
        if (!/^pours\/[A-Za-z0-9]{8,40}\/[A-Za-z0-9._-]{1,120}$/.test(pathname)) throw new TodoError(400, "That isn't a pour's photo.");
        return {
          allowedContentTypes: ["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"],
          maximumSizeInBytes: 80 * 1024 * 1024,
          addRandomSuffix: true,
        };
      },
      // No call back once it's in: the phone tells the website itself (with the copy to look at).
    });
    return Response.json(answer);
  } catch (error) {
    const status = error instanceof TodoError ? error.status : 400;
    return Response.json({ error: error instanceof Error ? error.message : "The upload couldn't start." }, { status });
  }
}
