import { redirect } from "next/navigation";

import { SiteApp } from "@/components/todo/SiteApp";
import { TodoSignIn } from "@/components/todo/TodoSignIn";
import { getDashboard } from "@/lib/dashboard/server";
import { opensRollcall } from "@/lib/rollcall/shared";
import { ghanaDay } from "@/lib/store/shared";
import { getTodoUser } from "@/lib/todo/server";
import { isPageSection, sectionHref } from "@/lib/todo/shared";

export const dynamic = "force-dynamic";

/**
 * The site app's home page (Niko, 30 Oct 2026: "the site to do app will open to the dashboard page then I
 * click into what information I want to put in"): a tile for each part this login opens, with how it
 * stands today. Not signed in: the app's own sign-in, so the home-screen app never leaves /todo.
 */
export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await getTodoUser();
  if (!me) return <TodoSignIn />;
  const params = await searchParams;
  // Links from before the home page (a phone alert's /todo?open=<job>, /todo?list=house) open the to-do list.
  if (me.sections.includes("todo") && ("open" in params || "list" in params || "alert" in params)) {
    const query = new URLSearchParams(Object.entries(params).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
    redirect(`/todo/jobs?${query}`);
  }
  // A login that opens one thing goes straight there (a storekeeper to the store, the roll call clerk to the roll call).
  const pages = me.sections.filter(isPageSection);
  const rollcall = opensRollcall(me.sections);
  if (!pages.length && rollcall) redirect("/todo/rollcall");
  if (pages.length === 1 && !rollcall) redirect(sectionHref(pages[0]));
  if (!pages.length) return <p style={{ padding: 24 }}>This login doesn&rsquo;t open anything yet. Ask the office.</p>;
  // The tiles' figures come with the page (18 Nov 2026, Niko: "The app takes forever to load on my phone"): the page
  // starts at once and the figures follow in the same answer, instead of the phone asking for them once its code has
  // started. A failure here just leaves the phone to ask, as before.
  const figures = getDashboard(me).catch(() => null);
  return <SiteApp me={me} section="home" initial={{}} firstHome={{ today: ghanaDay(), figures }} startedOffline={false} />;
}
