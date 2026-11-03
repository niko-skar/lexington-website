import { originalLink } from "@/lib/concrete/pourFiles";
import { errorResponse, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/** GET /api/concrete/pour-photo/:id: a pre-pour photo's original at full size (a link that lasts an hour). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    await requireTodoUser(false, "concrete");
    const { id } = await params;
    return Response.redirect(await originalLink(id), 302);
  } catch (error) {
    return errorResponse(error);
  }
}
