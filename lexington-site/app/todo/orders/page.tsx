import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteApp } from "@/components/todo/SiteApp";
import { TodoSignIn } from "@/components/todo/TodoSignIn";
import { ordersPage } from "@/lib/orders/server";
import type { OrdersPage } from "@/lib/orders/shared";
import { getTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Orders | The Lexington" };

/** Purchase orders (5 Nov 2026, the office only, in Finance): what's to be bought, from whom, by when, and what became of it. */
export default async function OrdersRoute() {
  const me = await getTodoUser();
  if (!me) return <TodoSignIn next="/todo/orders" />;
  if (me.kind !== "admin" || !me.sections.includes("orders")) redirect("/todo");
  let orders: OrdersPage | null = null;
  let failed = false;
  try {
    orders = await ordersPage(me);
  } catch (error) {
    console.error("[orders] load failed:", error instanceof Error ? error.message : error);
    failed = true;
  }
  return <SiteApp me={me} section="orders" initial={orders ? { orders } : {}} startedOffline={failed} />;
}
