import { compareMomo, lookupMomoName, titleCase } from "@/lib/rollcall/momoName";
import { recordMomoCheck, requireRollcallUser } from "@/lib/rollcall/server";
import { rollcallAccess } from "@/lib/rollcall/shared";
import { errorResponse, readJson, TodoError } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

const SAY: Record<string, [number, string]> = {
  off: [503, "The MoMo name check isn't switched on yet."],
  invalid: [400, "That isn't a Ghana MoMo number. Check the digits (10, starting 02 or 05)."],
  not_found: [404, "No MoMo account found on that number (MTN, Telecel or AT). Check the number with the worker."],
  unreachable: [502, "Couldn't reach the MoMo check just now. Try again in a minute."],
};

/**
 * POST { number, worker?, name?, momoName? }: the name a MoMo number is registered in (21 Nov 2026,
 * lib/rollcall/momoName.ts), and how it compares with the worker's name and the MoMo name typed for them. For a saved
 * worker whose MoMo is that number, the check is kept on their record. Logins that open Workers or Payday (they see the
 * numbers already).
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const me = await requireRollcallUser();
    const can = rollcallAccess(me.sections);
    if (!can.workers && !can.payday) throw new TodoError(403, "This login can't check MoMo names. Ask the office.");
    const body = await readJson(request);
    const found = await lookupMomoName(String(body.number ?? "").slice(0, 40));
    // Who asked about which number, never the name (the server's own log).
    console.info(`[momo-name] ${me.id} …${(found.number ?? "").slice(-3)} ${found.ok ? found.network : found.reason}`);
    if (!found.ok) {
      const [status, error] = SAY[found.reason];
      return Response.json({ error, reason: found.reason }, { status });
    }
    const worker = typeof body.worker === "string" ? body.worker : "";
    const name = String(body.name ?? "").slice(0, 120);
    const momoName = String(body.momoName ?? "").slice(0, 120);
    const doc = worker && found.number ? await recordMomoCheck(me, worker, { number: found.number, name: found.name, network: found.network }) : null;
    return Response.json(
      { name: titleCase(found.name), network: found.network, number: found.number, ...compareMomo(found.name, name, momoName), doc },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
