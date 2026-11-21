import { changeFilings, filingSheet, filingsPage } from "@/lib/filings/server";
import { errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/filings: the company's calendar (returns due, the one-off set-up, the settings). The office only.
 * GET /api/filings?form=vat&period=2026-12: one return's figures for a month (a month before the start is practice).
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await requireTodoUser(true, "filings");
    const url = new URL(request.url);
    const form = url.searchParams.get("form");
    if (form) return Response.json(await filingSheet(form, url.searchParams.get("period")), { headers: { "Cache-Control": "no-store" } });
    return Response.json(await filingsPage(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/filings (lib/filings/server.ts changeFilings says each action). Answers with the page as it is now. */
export async function POST(request: Request): Promise<Response> {
  try {
    const me = await requireTodoUser(true, "filings");
    await changeFilings(me, await readJson(request));
    return Response.json(await filingsPage());
  } catch (error) {
    return errorResponse(error);
  }
}
