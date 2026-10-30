import { getDashboard } from "@/lib/dashboard/server";
import { errorResponse, getTodoUser, TodoError } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/** GET /api/dashboard: the home page's figures, for the parts this login opens. */
export async function GET(): Promise<Response> {
  try {
    const me = await getTodoUser();
    if (!me) throw new TodoError(401, "You've been signed out. Open the app again to sign in.");
    return Response.json(await getDashboard(me), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
