"use client";

import { useActionState, useEffect, useRef } from "react";

import { sendWhatsAppAction, type WhatsAppFormState } from "@/lib/actions/whatsapp";
import { formatWhen } from "@/lib/crm";
import type { Lead } from "@/lib/sanity/crmTypes";
import styles from "./Crm.module.css";
import { useHostAction } from "./CrmHost";
import { FormMessage, SubmitButton } from "./FormBits";
import { useToast } from "./Toasts";

const idle: WhatsAppFormState = { status: "idle", message: "" };
const WINDOW_MS = 24 * 3_600_000;

/**
 * The prospect's chat with The Lexington's WhatsApp number (Cloud API, 26 Nov 2026). That number has no phone app, so
 * this box is where Niko or the team write to them by hand. The chat itself is in their notes. WhatsApp allows typed
 * messages only within 24 hours of the person's last message; outside that, the box says so.
 */
export function WhatsAppPanel({
  lead,
  lastTheirsAt,
  open,
}: {
  lead: Pick<Lead, "_id" | "name" | "whatsappFirst">;
  lastTheirsAt: string | null;
  /** Within 24 hours of their last message when the page was read (worked out on the server). */
  open: boolean;
}) {
  const toast = useToast();
  const action = useHostAction(sendWhatsAppAction);
  const [state, send] = useActionState(action, idle);
  const form = useRef<HTMLFormElement>(null);
  // Each answer is told once: the page is read again after a send, and the effect runs again then.
  const told = useRef<WhatsAppFormState | null>(null);

  useEffect(() => {
    if (state.status !== "success" || told.current === state) return;
    told.current = state;
    toast.show(state.message);
    form.current?.reset();
  }, [state, toast]);

  const last = lastTheirsAt ? Date.parse(lastTheirsAt) : Number.NaN;
  const until = Number.isFinite(last) ? last + WINDOW_MS : Number.NaN;
  const first = lead.whatsappFirst;

  return (
    <section className={styles.replyPanel} aria-label="WhatsApp">
      <div className={styles.replyHead}>
        <h2 className={styles.panelTitle}>WhatsApp</h2>
      </div>
      {first?.status === "sent" && first.at && (
        <p className={styles.replyWhy}>The first message went by itself from The Lexington&apos;s number, {formatWhen(first.at)} GMT.</p>
      )}
      {first?.status === "failed" && (
        <p className={styles.replyWhy}>The first message could not be sent{first.error ? ` (${first.error})` : ""}. Call them or email them.</p>
      )}
      <p className={styles.sectionHint} style={{ marginBottom: open ? 12 : 0 }}>
        {open
          ? `They last wrote ${formatWhen(lastTheirsAt as string)} GMT. You can write to them here until ${formatWhen(new Date(until).toISOString())} GMT; the assistant then stays quiet in this chat for 12 hours. The chat is in their notes.`
          : lastTheirsAt
            ? "It's more than 24 hours since they last wrote, and WhatsApp then lets The Lexington's number send only the approved first message. Call them or email them; when they write again, you can answer here."
            : "They haven't written back yet. When they do, the assistant answers them, and you can write to them here too. The chat is in their notes."}
      </p>
      {open && (
        <form ref={form} action={send}>
          <input type="hidden" name="leadId" value={lead._id} />
          <div className={`${styles.field} ${styles.replyBody}`}>
            <label htmlFor="wa-text">Message to {lead.name}</label>
            <textarea id="wa-text" name="text" required maxLength={4000} />
          </div>
          <div className={styles.replyActions}>
            <SubmitButton pendingText="Sending…">Send on WhatsApp</SubmitButton>
          </div>
          <FormMessage state={state.status === "error" ? state : idle} />
        </form>
      )}
    </section>
  );
}
