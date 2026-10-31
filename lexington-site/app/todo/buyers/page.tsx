import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteApp } from "@/components/todo/SiteApp";
import { TodoSignIn } from "@/components/todo/TodoSignIn";
import { listBuyers } from "@/lib/buyers/payments";
import type { BuyersData } from "@/lib/buyers/shared";
import { getTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Buyers | The Lexington" };

/** The buyers' payments (31 Oct 2026, the office only): log one, and its receipt is emailed and on their page at once. */
export default async function BuyersPage() {
  const me = await getTodoUser();
  if (!me) return <TodoSignIn next="/todo/buyers" />;
  if (me.kind !== "admin" || !me.sections.includes("buyers")) redirect("/todo");
  let buyers: BuyersData = { buyers: [], lastRate: null };
  let failed = false;
  try {
    buyers = await listBuyers();
  } catch (error) {
    console.error("[buyers] load failed:", error instanceof Error ? error.message : error);
    failed = true;
  }
  return <SiteApp me={me} section="buyers" initial={{ buyers }} startedOffline={failed} />;
}
