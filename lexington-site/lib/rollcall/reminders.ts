import "server-only";

import { pushToPhones } from "@/lib/alerts/notify";
import { reminderAt, type RollcallCheck } from "./reminderTimes";

// Sending the roll call's reminders (./reminderTimes says which and when): a buzz, nothing more, on the office's
// phones only (Niko, 11 Nov 2026: "it's only for my login"), never a site login's. A tap opens the roll call.
// Nothing lands in the Alerts list (17 a week would bury the rest), and a reminder sent twice only replaces itself
// on the lock screen (its tag).
export async function sendRollcallReminder(now: Date = new Date()): Promise<{ check: RollcallCheck | null; sent: number; failed: number }> {
  const reminder = reminderAt(now);
  if (!reminder) return { check: null, sent: 0, failed: 0 };
  const result = await pushToPhones({
    title: reminder.title,
    body: reminder.body,
    url: "/todo/rollcall#today",
    tag: `rollcall-${reminder.day}-${reminder.check}`,
  });
  return { check: reminder.check, ...result };
}
