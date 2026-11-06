import { itemToTool, toolToItem } from "@/lib/store/switchKind";
import { errorResponse, readJson, requireTodoUser, TodoError } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/store/switch { from: "item", id, count, condition }: the office moves a material to the tools;
 * { from: "tool", id, count, unit }: a tool to the materials (lib/store/switchKind.ts). Answers with the new one.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const me = await requireTodoUser(true, "store");
    const body = await readJson(request);
    const id = typeof body.id === "string" ? body.id : "";
    if (body.from === "item") return Response.json({ tool: await itemToTool(me, id, body) });
    if (body.from === "tool") return Response.json({ item: await toolToItem(me, id, body) });
    throw new TodoError(400, "Say which it is now: a tool or a material.");
  } catch (error) {
    return errorResponse(error);
  }
}
