import "server-only";

import { getAdminSession } from "@/lib/auth/session";
import { currentTodoUser } from "@/lib/todo/server";

// Who may use the CRM (19 Nov 2026): the office (the admin pages, or the app signed in as an admin), and since then an
// app login the office gave Customers to (Niko: "Make me a login for Rahma where she can access our ERP but only access
// the CRM system"). Only the office makes buyer logins from a prospect or deletes one.

export interface CrmActor {
  /** The office: everything, as on the admin pages. */
  office: boolean;
  /** A login's name (Rahma), written on the notes it adds; none for the office. */
  by?: string;
}

export async function crmActor(): Promise<CrmActor | null> {
  if (await getAdminSession()) return { office: true };
  const me = await currentTodoUser();
  if (!me || !me.sections.includes("prospects")) return null;
  return me.kind === "admin" ? { office: true } : { office: false, by: me.name };
}

/** A change made from the app's Customers part: the app reads the CRM again itself, so the admin pages aren't redrawn. */
export const fromApp = (formData: FormData) => formData.get("inApp") === "1";
