import { testConnection } from "@/lib/quickbooks/client";
import { backToPage, guard } from "@/lib/quickbooks/routes";
import { writeLog } from "@/lib/quickbooks/store";

export const dynamic = "force-dynamic";

/** POST /api/quickbooks/test: the "Test the connection" button. The answer is the newest log line. */
export async function POST(request: Request): Promise<Response> {
  const refused = await guard(request, true);
  if (refused) return refused;
  try {
    await testConnection();
    return backToPage(request, { ok: "tested" });
  } catch (error) {
    await writeLog({
      action: "test",
      ok: false,
      httpStatus: null,
      intuitTid: null,
      message: error instanceof Error ? error.message : "The test failed.",
    });
    return backToPage(request, { err: "test" });
  }
}
