import "server-only";

import { remindInChat } from "@/lib/agents/chat";
import { notifyOwner } from "@/lib/alerts/notify";
import { firstName } from "@/lib/crm";
import { googleMapsUrl } from "@/lib/maps";

import { BOOKED_VIA, VISIT_PLACE, slotKey, slotLabel, slotStartMs, timeLabel } from "./shared";
import { bookedOn, emailReminder, jobState, markReminded, saveJobState, whatsappNote, type JobVisit } from "./store";

/**
 * The site visits' daily jobs (vercel.json runs /api/cron/site-visits at 06:05, 17:05 and 19:05, Accra time = UTC):
 * - morning: Niko's list of today's visits (a buzz on his phone);
 * - late afternoon: tomorrow's visitors are reminded (by email, and in the chat they booked in), and Niko gets a
 *   one-tap WhatsApp reminder for anyone neither can reach;
 * - evening: "did they come?" for today's visits still unmarked (marking one "didn't come" sends them a
 *   "pick another time" email).
 * Each runs once a day whatever time it is called in its window (a small state document says which day it last ran).
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;

const visitLine = (v: JobVisit) =>
  [
    `${timeLabel(v.slot)} ${v.name}`,
    v.people ? `${v.people} ${v.people === 1 ? "person" : "people"}` : "",
    v.phone,
    v.interest && v.interest !== "Not sure yet" ? v.interest.toLowerCase() : "",
    v.source !== "website" ? `booked ${BOOKED_VIA[v.source]}` : "",
  ]
    .filter(Boolean)
    .join(", ");

export function chatReminderText(v: { name: string; slot: string }, address: string): string {
  return `Hi ${firstName(v.name)}, a reminder of your visit to The Lexington tomorrow, ${slotLabel(v.slot)}. We are at ${address}: ${googleMapsUrl()}. If you need to change the time, just reply here.`;
}

export interface VisitJobsRun {
  digest?: number;
  reminded?: number;
  remindByHand?: number;
  nudged?: number;
}

export async function runVisitJobs(nowMs = Date.now(), address = VISIT_PLACE): Promise<VisitJobsRun> {
  const hour = new Date(nowMs).getUTCHours();
  const today = slotKey(nowMs).slice(0, 10);
  const tomorrow = slotKey(nowMs + DAY).slice(0, 10);
  const state = await jobState();
  const run: VisitJobsRun = {};

  // ---- the morning list
  if (hour >= 5 && hour < 10 && state.digest !== today) {
    const visits = await bookedOn(today);
    if (visits.length) {
      await notifyOwner({
        kind: "visit",
        urgent: true,
        title: `Site visits today: ${visits.length}`,
        lines: visits.map(visitLine),
        links: [{ label: "Site visits", url: "/todo/visits" }],
        open: "/todo/visits",
      });
    }
    await saveJobState(state.id, { digest: today });
    run.digest = visits.length;
  }

  // ---- tomorrow's reminders
  if (hour >= 16 && hour < 21 && state.reminders !== today) {
    const visits = await bookedOn(tomorrow);
    const byHand: JobVisit[] = [];
    let reminded = 0;
    for (const v of visits) {
      if (v.remindedAt) continue;
      // Booked in the last few hours: their confirmation is fresh, a reminder would only repeat it.
      if (Date.parse(v.createdAt) > nowMs - 6 * HOUR) {
        await markReminded(v.id, "booked-recently");
        continue;
      }
      const ways: string[] = [];
      if (v.email && (await emailReminder(v.id))) ways.push("email");
      if (v.threadId && (await remindInChat(v.threadId, chatReminderText(v, address))) === "sent") ways.push("chat");
      if (ways.length) {
        await markReminded(v.id, ways.join("+"));
        reminded += 1;
      } else {
        byHand.push(v);
      }
    }
    if (byHand.length) {
      await notifyOwner({
        kind: "visit",
        urgent: true,
        title: `Remind ${byHand.length === 1 ? `${firstName(byHand[0].name)} about tomorrow's visit` : `${byHand.length} visitors about tomorrow`}`,
        lines: [
          ...byHand.map((v) => `${visitLine(v)}: no email${v.threadId ? " and the chat is closed" : ""}, so no automatic reminder.`),
          "Tap a WhatsApp link below: the reminder is written for you.",
        ],
        links: [
          ...byHand
            .filter((v) => v.phone)
            .slice(0, 5)
            .map((v) => ({ label: `WhatsApp ${firstName(v.name)}`, url: whatsappNote(v, "reminder") })),
          { label: "Site visits", url: "/todo/visits" },
        ],
        open: "/todo/visits",
      });
    }
    await saveJobState(state.id, { reminders: today });
    run.reminded = reminded;
    run.remindByHand = byHand.length;
  }

  // ---- did they come?
  if (hour >= 18 && hour < 24 && state.nudge !== today) {
    const visits = (await bookedOn(today)).filter((v) => (slotStartMs(v.slot) ?? 0) + HOUR <= nowMs);
    if (visits.length) {
      await notifyOwner({
        kind: "visit",
        urgent: true,
        title: `Did they come? ${visits.length === 1 ? `${firstName(visits[0].name)}'s visit` : `${visits.length} visits`} today`,
        lines: [
          ...visits.map(visitLine),
          `Mark each one in Site visits. "Didn't come" emails them to pick another time.`,
        ],
        links: [{ label: "Mark them", url: "/todo/visits" }],
        open: "/todo/visits",
      });
    }
    await saveJobState(state.id, { nudge: today });
    run.nudged = visits.length;
  }

  return run;
}

