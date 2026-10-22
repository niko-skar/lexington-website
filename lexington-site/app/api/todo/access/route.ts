import {
  createSiteAccount,
  errorResponse,
  listSiteAccounts,
  readJson,
  removeSiteAccount,
  requireTodoUser,
  resetSiteAccount,
  setSiteAccess,
} from "@/lib/todo/server";

export const dynamic = "force-dynamic";

// Logins for the foreman or a storekeeper: people who should only see the site to-do list and/or
// the store room. The office only. The password is shown once, to be sent on; it is never stored
// readable.

export async function GET(): Promise<Response> {
  try {
    await requireTodoUser(true);
    return Response.json({ accounts: await listSiteAccounts() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST { name, email, sections }: a new "site" login that opens "todo" and/or "store". */
export async function POST(request: Request): Promise<Response> {
  try {
    await requireTodoUser(true);
    return Response.json(await createSiteAccount(await readJson(request)), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

/** PATCH { id }: a new password for a site login. PATCH { id, sections }: what it opens. */
export async function PATCH(request: Request): Promise<Response> {
  try {
    await requireTodoUser(true);
    const body = await readJson(request);
    if ("sections" in body) return Response.json({ sections: await setSiteAccess(String(body.id || ""), body.sections) });
    return Response.json({ password: await resetSiteAccount(String(body.id || "")) });
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE ?id=: removes a site login (it stops working within a minute). */
export async function DELETE(request: Request): Promise<Response> {
  try {
    await requireTodoUser(true);
    await removeSiteAccount(new URL(request.url).searchParams.get("id") || "");
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
