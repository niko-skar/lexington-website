import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteApp } from "@/components/todo/SiteApp";
import { TodoSignIn } from "@/components/todo/TodoSignIn";
import { opensRollcall } from "@/lib/rollcall/shared";
import { getTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Roll call | The Lexington" };

/** The roll call inside the app (2 Nov 2026): its page in the app's frame (components/todo/RollcallPart.tsx); #week opens Payday. */
export default async function RollcallPage() {
  const me = await getTodoUser();
  if (!me) return <TodoSignIn next="/todo/rollcall" />;
  if (!opensRollcall(me.sections)) redirect("/todo");
  return <SiteApp me={me} section="rollcall" initial={{}} startedOffline={false} />;
}
