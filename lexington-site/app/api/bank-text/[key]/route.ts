import { after } from "next/server";

import { bankLinkOk, receiveBankText } from "@/lib/expenses/bankText";
import { syncExpense } from "@/lib/expenses/sheet";
import { feedExpense } from "@/lib/quickbooks/feed";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY = 8_000;

/** What the iPhone sent: JSON ({"text": ...}, or any one text field), a form, or the bare text. */
async function messageText(request: Request): Promise<{ text: string; dryRun: boolean }> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("form")) {
    const form = await request.formData().catch(() => null);
    const value = form?.get("text") ?? [...(form?.values() ?? [])].find((v) => typeof v === "string");
    return { text: typeof value === "string" ? value.slice(0, MAX_BODY) : "", dryRun: false };
  }
  const raw = (await request.text()).slice(0, MAX_BODY);
  if (type.includes("json") || /^\s*[{"]/.test(raw)) {
    try {
      const data: unknown = JSON.parse(raw);
      if (typeof data === "string") return { text: data, dryRun: false };
      if (data && typeof data === "object" && !Array.isArray(data)) {
        const o = data as Record<string, unknown>;
        const value = typeof o.text === "string" ? o.text : Object.values(o).find((v) => typeof v === "string");
        return { text: typeof value === "string" ? value : "", dryRun: o.dryRun === true };
      }
    } catch {
      // Not JSON after all: the bare text.
    }
  }
  return { text: raw, dryRun: false };
}

/**
 * POST /api/bank-text/<private key>: one text from the bank, passed on by Niko's iPhone (see
 * lib/expenses/bankText.ts). Without the right key it is a plain "not found".
 */
export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }): Promise<Response> {
  try {
    const { key } = await params;
    if (!(await bankLinkOk(key))) return new Response("Not found", { status: 404 });
    const { text, dryRun } = await messageText(request);
    const result = await receiveBankText(text, { dryRun });
    // New entries (money in, a bank fee) are off to the Google Sheet and QuickBooks, as typed ones (the crons catch up any miss).
    for (const id of result.filed) {
      after(() => syncExpense(id));
      after(() => feedExpense(id));
    }
    return Response.json({ ok: true, result: result.result, ref: result.ref }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[bank-text]", error instanceof Error ? error.message : error);
    return Response.json({ ok: false }, { status: 502 });
  }
}
