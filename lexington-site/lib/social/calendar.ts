import calendarJson from "./calendar.json";
import type { SocialCalendar, SocialPost } from "./types";

export const calendar = calendarJson as unknown as SocialCalendar;

export function postForDate(date: string): SocialPost | undefined {
  return calendar.posts.find((p) => p.date === date);
}
