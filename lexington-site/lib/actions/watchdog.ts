"use server";

import { revalidatePath } from "next/cache";

import { runWatchdog } from "@/lib/agents/watchdog";
import { getAdminSession } from "@/lib/auth/session";

/** The dashboard's "Check now": the same check as the morning one, without the email. */
export async function runWatchdogAction(): Promise<void> {
  if (!(await getAdminSession())) throw new Error("Not authorized.");
  await runWatchdog({ email: false });
  revalidatePath("/admin/dashboard");
}
