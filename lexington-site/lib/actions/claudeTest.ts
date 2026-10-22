"use server";

import { testClaude } from "@/lib/ai/claude";
import { getAdminSession } from "@/lib/auth/session";

export interface ClaudeTestState {
  status: "idle" | "ok" | "error";
  message: string;
}

/** The Connect page's "Test it": one tiny request, to prove the key works. */
export async function testClaudeAction(): Promise<ClaudeTestState> {
  if (!(await getAdminSession())) return { status: "error", message: "Please sign in again." };
  const result = await testClaude();
  return result.ok
    ? { status: "ok", message: "Claude answered: the key works." }
    : { status: "error", message: result.error };
}
