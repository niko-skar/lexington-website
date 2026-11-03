import { cubeReminders } from "@/lib/concrete/pourFiles";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Every morning at 7 (vercel.json): a concrete cube test due today, or two days late without its results, buzzes the
// office's phone. Vercel sends "Authorization: Bearer <CRON_SECRET>"; without it nothing runs.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    return Response.json(await cubeReminders());
  } catch (err) {
    console.error("Cube reminders failed:", err);
    return new Response("Cube reminders failed.", { status: 500 });
  }
}
