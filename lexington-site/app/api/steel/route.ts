import { changeSteel, steelData } from "@/lib/steel/server";
import { errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/** GET /api/steel: the steel tracker (tons bought, installed, in stock; labour earned, paid, owed). The office only. */
export async function GET(): Promise<Response> {
  try {
    const me = await requireTodoUser(true, "steel");
    return Response.json(await steelData(me), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/steel { action: "install" | "delete" | "rate" | "tons", ... }: see lib/steel/server.ts changeSteel. */
export async function POST(request: Request): Promise<Response> {
  try {
    const me = await requireTodoUser(true, "steel");
    return Response.json(await changeSteel(me, await readJson(request)));
  } catch (error) {
    return errorResponse(error);
  }
}
