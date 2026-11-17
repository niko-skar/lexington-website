"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { PORTAL_VIEW_COOKIE, PORTAL_VIEW_PATH } from "@/lib/auth/portalView";

// Ends "View portal" (lib/auth/portalView.ts) and goes back to the admin's list of buyers. Needs no check of its own:
// all it does is forget which buyer was being looked at.
export async function stopPortalViewAction() {
  (await cookies()).set(PORTAL_VIEW_COOKIE, "", { path: PORTAL_VIEW_PATH, maxAge: 0 });
  redirect("/admin");
}
