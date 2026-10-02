import "server-only";
import { redirect } from "next/navigation";

import { getAdminSession } from "./session";

// Defense in depth alongside proxy.ts: every admin page checks for itself too.
export async function requireAdminPage() {
  if (!(await getAdminSession())) {
    redirect("/admin/login");
  }
}
