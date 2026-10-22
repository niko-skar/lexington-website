"use client";

import { useActionState, useEffect, useState, useTransition } from "react";

import {
  discardReplyAction,
  markWhatsAppSentAction,
  redraftReplyAction,
  sendReplyAction,
  type ReplyFormState,
} from "@/lib/actions/leadReply";
import { formatWhen } from "@/lib/crm";
import { whatsappUrl } from "@/lib/format";
import type { Lead } from "@/lib/sanity/crmTypes";
import styles from "./Crm.module.css";
import { FormMessage, SubmitButton } from "./FormBits";
import { useToast } from "./Toasts";

const idle: ReplyFormState = { status: "idle", message: "" };

const TEMP: Record<string, { label: string; className: string }> = {
  hot: { label: "Hot lead", className: styles.tempHot },
  warm: { label: "Warm", className: styles.tempWarm },
  cold: { label: "Cold", className: styles.tempCold },
};

type ReplyLead = Pick<Lead, "_id" | "name" | "email" | "phone" | "replyDraft">;

/**
 * The lead responder's suggested first reply, on the prospect's page: read it,
 * change anything, then send it by email or open it in WhatsApp. When there is
 * none (or it was put aside), one can be written here, from a message pasted in.
 */
export function ReplyPanel({ lead }: { lead: ReplyLead }) {
  const draft = lead.replyDraft;
  if (draft?.status === "draft") return <DraftReply key={draft.createdAt} lead={lead} />;
  return <NoDraft key={draft?.createdAt ?? "none"} lead={lead} />;
}

function DraftReply({ lead }: { lead: ReplyLead }) {
  const draft = lead.replyDraft!;
  const toast = useToast();
  const [sendState, send] = useActionState(sendReplyAction, idle);
  const [whatsapp, setWhatsapp] = useState(draft.whatsapp);
  const [waOpened, setWaOpened] = useState(false);
  const [pending, startTransition] = useTransition();
  const temp = draft.temperature ? TEMP[draft.temperature] : null;

  useEffect(() => {
    if (sendState.status === "success") toast.show(sendState.message);
  }, [sendState, toast]);

  return (
    <section className={styles.replyPanel} aria-label="Suggested reply">
      <div className={styles.replyHead}>
        <h2 className={styles.panelTitle}>Suggested reply</h2>
        {temp && <span className={temp.className}>{temp.label}</span>}
      </div>
      {draft.temperatureReason && <p className={styles.replyWhy}>{draft.temperatureReason}</p>}

      {draft.warnings.length > 0 && (
        <div className={styles.checkBox} role="note">
          <strong>Check before sending</strong>
          <ul>
            {draft.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <form
        action={send}
        onSubmit={(e) => {
          if (!window.confirm(`Send this reply to ${lead.email}?`)) e.preventDefault();
        }}
      >
        <input type="hidden" name="leadId" value={lead._id} />
        <div className={styles.field} style={{ marginBottom: 12 }}>
          <label htmlFor="r-subject">Subject</label>
          <input id="r-subject" name="subject" defaultValue={draft.subject} required maxLength={160} />
        </div>
        <div className={`${styles.field} ${styles.replyBody}`}>
          <label htmlFor="r-body">Email</label>
          <textarea id="r-body" name="body" defaultValue={draft.body} required />
        </div>
        <div className={styles.replyActions}>
          {lead.email ? (
            <SubmitButton pendingText="Sending…">Send email to {lead.email}</SubmitButton>
          ) : (
            <span className={styles.sectionHint}>No email address: use WhatsApp, or add their email under Details.</span>
          )}
        </div>
        <FormMessage state={sendState.status === "error" ? sendState : idle} />
      </form>

      {lead.phone && (
        <details className={styles.replyMore} open={!lead.email}>
          <summary>WhatsApp version</summary>
          <div className={styles.field}>
            <label htmlFor="r-wa">Message</label>
            <textarea id="r-wa" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
          </div>
          <div className={styles.replyActions}>
            <a
              className={styles.btn}
              href={whatsappUrl(lead.phone, whatsapp)}
              target="_blank"
              rel="noreferrer"
              onClick={() => setWaOpened(true)}
            >
              Open in WhatsApp
            </a>
            {waOpened && (
              <button
                type="button"
                className={styles.btnPrimary}
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const data = new FormData();
                    data.set("leadId", lead._id);
                    data.set("whatsapp", whatsapp);
                    try {
                      await markWhatsAppSentAction(data);
                      toast.show("Marked as sent on WhatsApp.");
                    } catch {
                      toast.show("Couldn't save that. Please try again.");
                    }
                  })
                }
              >
                {pending ? "Saving…" : "I sent it: mark as sent"}
              </button>
            )}
          </div>
        </details>
      )}

      <details className={styles.replyMore}>
        <summary>Write it again, or put it aside</summary>
        <Redraft leadId={lead._id} label="Write it again" />
        <form action={discardReplyAction} style={{ marginTop: 10 }}>
          <input type="hidden" name="leadId" value={lead._id} />
          <SubmitButton className={styles.btn} pendingText="Putting aside…">
            Put this reply aside (I answered another way)
          </SubmitButton>
        </form>
      </details>

      <p className={styles.writerNote}>
        {draft.writer === "claude" ? "Written by Claude" : "Standard reply"} from the live unit list and offer,{" "}
        {formatWhen(draft.createdAt)} GMT. Suggests: {draft.units.join(", ") || "no particular unit"}.
        {draft.note ? ` ${draft.note}` : ""}
      </p>
    </section>
  );
}

function NoDraft({ lead }: { lead: ReplyLead }) {
  const draft = lead.replyDraft;
  return (
    <section className={styles.panel} aria-label="Suggested reply">
      <h2 className={styles.panelTitle}>Suggested reply</h2>
      {draft?.status === "sent" && (
        <details className={styles.replyMore} style={{ marginTop: 0, marginBottom: 14 }}>
          <summary>
            First reply sent {draft.sentVia === "whatsapp" ? "on WhatsApp" : draft.sentVia === "auto-email" ? "by email, automatically" : "by email"}
            {draft.sentAt ? `, ${formatWhen(draft.sentAt)} GMT` : ""}
          </summary>
          <div className={styles.sentText}>{draft.sentVia === "whatsapp" ? draft.body : `${draft.subject}\n\n${draft.body}`}</div>
        </details>
      )}
      <details className={styles.replyMore} style={{ marginTop: 0 }}>
        <summary>{draft?.status === "sent" ? "Write another reply" : "Write a suggested reply"}</summary>
        <p className={styles.sectionHint} style={{ marginBottom: 12 }}>
          Paste what they wrote (a WhatsApp chat, notes from a call) and a reply is written from the live unit list and the
          current offer. Leave it empty to write one from what is already known about them.
        </p>
        <Redraft leadId={lead._id} label="Write a suggested reply" />
      </details>
    </section>
  );
}

function Redraft({ leadId, label }: { leadId: string; label: string }) {
  const [state, action] = useActionState(redraftReplyAction, idle);
  return (
    <form action={action}>
      <input type="hidden" name="leadId" value={leadId} />
      <div className={styles.field} style={{ marginBottom: 10 }}>
        <label htmlFor={`m-${label}`}>What they wrote (optional)</label>
        <textarea id={`m-${label}`} name="message" placeholder="e.g. Hello, is the 2 bedroom on the 3rd floor still available? What are the payment terms?" />
      </div>
      <SubmitButton pendingText="Writing… (up to a minute)">{label}</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
