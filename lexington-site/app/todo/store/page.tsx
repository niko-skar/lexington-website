import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { StoreApp } from "@/components/todo/StoreApp";
import { TodoSignIn } from "@/components/todo/TodoSignIn";
import { getStore } from "@/lib/store/server";
import type { StoreEntry, StoreItem } from "@/lib/store/shared";
import { getTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Store room | The Lexington" };

/**
 * The store room (Oct 2026). Stock goes up when the office logs a paid Material purchase "into the
 * store room"; the foreman, the office (and later a storekeeper) record what goes out, what comes
 * back, and counts. Site logins see quantities, never prices.
 */
export default async function StorePage() {
  const me = await getTodoUser();
  if (!me) return <TodoSignIn next="/todo/store" />;
  if (!me.sections.includes("store")) redirect("/todo");

  let items: StoreItem[] = [];
  let history: StoreEntry[] = [];
  let failed = false;
  try {
    ({ items, history } = await getStore(me));
  } catch (error) {
    console.error("[store] load failed:", error instanceof Error ? error.message : error);
    failed = true;
  }
  return <StoreApp me={me} initialItems={items} initialHistory={history} startedOffline={failed} />;
}
