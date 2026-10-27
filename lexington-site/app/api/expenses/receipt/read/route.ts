import { readReceipt } from "@/lib/expenses/readReceipt";
import { errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** POST /api/expenses/receipt/read { receiptId }: what the stored receipt says, for the form to fill in. Nothing is saved. */
export async function POST(request: Request): Promise<Response> {
  try {
    await requireTodoUser(true, "expenses");
    const { receiptId } = await readJson(request);
    return Response.json({ reading: await readReceipt(receiptId) });
  } catch (error) {
    return errorResponse(error);
  }
}
