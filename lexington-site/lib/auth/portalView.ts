import "server-only";
import { cookies } from "next/headers";

import { getAdminSession } from "./session";

// "View portal" (Niko, 17 Nov 2026: "a button that I can view any of the buyers' portal directly, not sign in as them,
// but view their portal page so I can check it looks how i want"). The admin's browser carries the id of the buyer
// account being looked at in a cookie; the buyer portal's pages then show that account. Nobody is signed in as the
// buyer: the cookie only counts beside an admin sign-in, it is only sent to the portal's pages (/account), it lasts
// two hours, and while it is on the portal's buttons that save or send do nothing (lib/actions/*). The portal says so
// in a band at the top, with the way back to the admin.
//   on:  /admin/view/<account id>   (app/admin/(protected)/view/[id]/route.ts)
//   off: "Back to Admin" in the band, or the portal's Sign Out (lib/actions/portalView.ts)
export const PORTAL_VIEW_COOKIE = "portal_view";
export const PORTAL_VIEW_PATH = "/account";
export const PORTAL_VIEW_SECONDS = 2 * 60 * 60;
export const ACCOUNT_ID_RE = /^[A-Za-z0-9._-]{1,80}$/;

/** The id of the buyer account an admin is looking at as the buyer sees it, or null. Only ever with an admin sign-in. */
export async function getPortalView(): Promise<string | null> {
  const id = (await cookies()).get(PORTAL_VIEW_COOKIE)?.value;
  if (!id || !ACCOUNT_ID_RE.test(id)) return null;
  if (!(await getAdminSession())) return null;
  return id;
}

/** What a button that saves or sends answers while an admin is only looking. */
export const VIEW_ONLY_MESSAGE = "You are viewing this portal as the buyer sees it. Nothing is saved or sent from here.";
