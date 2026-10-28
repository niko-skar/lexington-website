import { bankTextStatus, newBankLink } from "@/lib/expenses/bankText";
import { SITE_URL } from "@/lib/seo";
import { errorResponse, readJson, requireTodoUser, TodoError } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

// The live link always uses the website's own address; a preview or a laptop its own.
const originOf = (request: Request) => (process.env.VERCEL_ENV === "production" ? SITE_URL : new URL(request.url).origin);

/** GET /api/expenses/bank-text: the private link for the iPhone, and the last text that came. The office only. */
export async function GET(request: Request): Promise<Response> {
  try {
    await requireTodoUser(true, "expenses");
    return Response.json(await bankTextStatus(originOf(request)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/expenses/bank-text {action: "new-link"}: a new link; the old one stops working. */
export async function POST(request: Request): Promise<Response> {
  try {
    await requireTodoUser(true, "expenses");
    const body = await readJson(request);
    if (body.action !== "new-link") throw new TodoError(400, "That button isn't known.");
    return Response.json(await newBankLink(originOf(request)));
  } catch (error) {
    return errorResponse(error);
  }
}
