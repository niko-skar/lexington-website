import { revokeConnection } from "@/lib/quickbooks/client";
import { backToPage, guard } from "@/lib/quickbooks/routes";
import { deleteConnection } from "@/lib/quickbooks/store";

export const dynamic = "force-dynamic";

/** POST /api/quickbooks/disconnect: cancels the login at Intuit, then forgets it here. */
export async function POST(request: Request): Promise<Response> {
  const refused = await guard(request, true);
  if (refused) return refused;
  try {
    await revokeConnection();
    await deleteConnection();
    return backToPage(request, { ok: "disconnected" });
  } catch {
    return backToPage(request, { err: "disconnect" });
  }
}
