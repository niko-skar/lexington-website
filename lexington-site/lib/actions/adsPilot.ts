"use server";

import { revalidatePath } from "next/cache";

import { runAdsManager } from "@/lib/agents/adsManager";
import { runAdsPilot, setPilotPaused } from "@/lib/agents/adsPilot";
import { getAdminSession } from "@/lib/auth/session";

/** The dashboard's "Run now": the same runs as the morning ones, the ads first, then the budgets (unless paused). */
export async function runAdsPilotAction(): Promise<void> {
  if (!(await getAdminSession())) throw new Error("Not authorized.");
  await runAdsManager({ mode: "full" });
  await runAdsPilot();
  revalidatePath("/admin/dashboard");
}

/** Pause or resume the autopilot. Paused, it changes no adverts; the monthly spending limit stays. */
export async function setAdsPilotPausedAction(formData: FormData): Promise<void> {
  if (!(await getAdminSession())) throw new Error("Not authorized.");
  await setPilotPaused(formData.get("paused") === "1");
  revalidatePath("/admin/dashboard");
}
