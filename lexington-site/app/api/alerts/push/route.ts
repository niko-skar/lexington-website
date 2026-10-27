import { cleanSubscription, pushState, removePushSubscription, savePushSubscription, sendTest } from "@/lib/alerts/server";
import { errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

// Phone alerts for whoever is signed in: the office (its alerts, the jobs the foreman adds) and,
// since 27 Oct 2026, a site login that opens the to-do list (the jobs the office adds). Each only
// ever sees, tests or turns off its own phones.

/** GET: the website's side (keys set?) and the signed-in person's phones. */
export async function GET(): Promise<Response> {
  try {
    const me = await requireTodoUser();
    return Response.json(await pushState(me.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * POST { subscription, device }: this phone gets the signed-in person's alerts from now on.
 * POST { test: <phone id> }: a test alert to that phone. DELETE { id }: that phone stops getting them.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const me = await requireTodoUser();
    const body = await readJson(request);
    if (typeof body.test === "string") {
      const result = await sendTest(body.test, me.id);
      if (!result.sent) return Response.json({ error: "The test didn't reach this phone. Turn phone alerts off and on again." }, { status: 502 });
      return Response.json(result);
    }
    const state = await pushState(me.id);
    if (!state.configured) return Response.json({ error: "Phone alerts aren't switched on on the website yet." }, { status: 503 });
    const sub = cleanSubscription(body.subscription);
    if (!sub) return Response.json({ error: "This phone's details didn't come through. Try again." }, { status: 400 });
    const id = await savePushSubscription(sub, typeof body.device === "string" ? body.device : "Phone", me.id);
    return Response.json({ id, push: await pushState(me.id) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const me = await requireTodoUser();
    const body = await readJson(request);
    const which = typeof body.id === "string" ? body.id : typeof body.endpoint === "string" ? body.endpoint : "";
    if (!which) return Response.json({ error: "Which phone?" }, { status: 400 });
    await removePushSubscription(which, me.id);
    return Response.json({ push: await pushState(me.id) });
  } catch (error) {
    return errorResponse(error);
  }
}
