import { runDaily } from "@/lib/social/run";

// Posting a swipe-through post to two platforms takes a while (the pictures are fetched and processed on Meta's side).
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Called by Vercel on the schedule in vercel.json, twice a day: the second run only does what the first could not.
// Vercel sends "Authorization: Bearer <CRON_SECRET>"; without that secret set, or with a wrong one, nothing runs.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const dry = new URL(request.url).searchParams.get("dry") === "1";
  try {
    const result = await runDaily({ dryRun: dry, log: (m) => console.log("[social]", m) });
    return Response.json(result);
  } catch (err) {
    console.error("Social post run failed:", err);
    return new Response("Social post run failed.", { status: 500 });
  }
}
