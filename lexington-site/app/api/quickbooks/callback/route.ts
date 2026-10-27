import { timingSafeEqual } from "node:crypto";

import { exchangeCode, fetchCompany } from "@/lib/quickbooks/client";
import { qboKeys, qboRedirectUri } from "@/lib/quickbooks/config";
import { backToPage, guard, STATE_COOKIE } from "@/lib/quickbooks/routes";
import { saveCompany, saveNewConnection, writeLog } from "@/lib/quickbooks/store";

export const dynamic = "force-dynamic";

function sameState(a: string | null, b: string | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function cookieValue(request: Request, name: string): string | undefined {
  const raw = request.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

/**
 * GET /api/quickbooks/callback: where Intuit sends the browser back after sign-in, with a one-time
 * code, the company's id (realmId) and the state value from /connect. Admin only.
 */
export async function GET(request: Request): Promise<Response> {
  const refused = await guard(request, false);
  if (refused) return refused;

  const done = (result: Parameters<typeof backToPage>[1]) => {
    const response = backToPage(request, result);
    response.cookies.delete({ name: STATE_COOKIE, path: "/api/quickbooks" });
    return response;
  };

  const params = new URL(request.url).searchParams;
  const keys = qboKeys();
  if (!keys) return done({ err: "keys" });

  if (!sameState(params.get("state"), cookieValue(request, STATE_COOKIE))) {
    await writeLog({
      action: "callback",
      ok: false,
      httpStatus: null,
      intuitTid: null,
      message: "Sign-in answer refused: its state value did not match this browser's (possible forged request, or the sign-in took over 10 minutes).",
    });
    return done({ err: "state" });
  }

  const error = params.get("error");
  if (error) {
    await writeLog({ action: "callback", ok: false, httpStatus: null, intuitTid: null, message: `QuickBooks sign-in not completed: ${error}.` });
    return done({ err: error === "access_denied" ? "denied" : "signin" });
  }

  const code = params.get("code");
  const realmId = params.get("realmId");
  if (!code || !realmId) {
    await writeLog({ action: "callback", ok: false, httpStatus: null, intuitTid: null, message: "QuickBooks sent no sign-in code or company id." });
    return done({ err: "signin" });
  }

  try {
    const tokens = await exchangeCode(code, qboRedirectUri(request.url));
    await saveNewConnection(keys.environment, realmId, tokens, { name: null, country: null });
    try {
      await saveCompany(await fetchCompany());
    } catch {
      // Connected all the same; the name shows after the first test.
    }
    return done({ ok: "connected" });
  } catch {
    return done({ err: "signin" });
  }
}
