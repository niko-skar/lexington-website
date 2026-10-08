import { Resend } from "resend";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A short plain email to the owner about the daily posts. Never throws: a failed notice must not hide the real result. */
export async function sendNotice(subject: string, lines: string[]): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("RESEND_API_KEY is not set: cannot send the social notice:", subject);
    return false;
  }
  const to = process.env.SOCIAL_NOTIFY_EMAIL || "sales@lexington.com.gh";
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.55;color:#15181a;max-width:560px">${lines
    .map((l) => `<p style="margin:0 0 12px">${esc(l).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p>`)
    .join("")}</div>`;
  try {
    const result = await new Resend(apiKey).emails.send({ from: "The Lexington Website <sales@lexington.com.gh>", to, subject, html });
    if (result.error) {
      console.error("Resend rejected the social notice:", result.error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Could not send the social notice:", err);
    return false;
  }
}
