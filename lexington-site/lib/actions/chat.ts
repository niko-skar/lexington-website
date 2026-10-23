"use server";

import { revalidatePath } from "next/cache";

import { connectPage, setChatPaused } from "@/lib/agents/chat";
import { getAdminSession } from "@/lib/auth/session";

export type ConnectResult = { ok: true } | { ok: false; error: string };

/** The Connect page's "Connect the Page": the Page's messages start coming to the website. */
export async function connectPageAction(): Promise<ConnectResult> {
  if (!(await getAdminSession())) return { ok: false, error: "Your sign-in has run out. Sign in again." };
  const result = await connectPage();
  revalidatePath("/admin/dashboard/connect");
  return result;
}

/** Pause or resume the chat agent. Paused, every message waits for Niko (he is emailed about each chat). */
export async function setChatPausedAction(formData: FormData): Promise<void> {
  if (!(await getAdminSession())) throw new Error("Not authorized.");
  await setChatPaused(formData.get("paused") === "1");
  revalidatePath("/admin/dashboard/connect");
}
