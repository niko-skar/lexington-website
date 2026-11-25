"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { requestPriceList, type PriceListFormState } from "@/lib/actions/priceList";
import { trackLead, trackMetaEvent } from "@/lib/analytics";
import { PRICE_LIST_PATH } from "@/lib/priceList/path";
import { trackAction } from "@/lib/visits/client";
import styles from "./PriceListForm.module.css";

const initialState: PriceListFormState = { status: "idle", message: "" };

function SendButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.send} disabled={pending}>
      {pending ? "Sending…" : "Send me the price list"}
    </button>
  );
}

/**
 * "Send me the price list" (Niko, 25 Nov 2026: item 3 of the website plan, for visitors not ready to talk): a name and an
 * email or a WhatsApp number; the price list is emailed as a PDF and opens on the page straight away; they become a
 * prospect. `collapsed` shows only a small button until it is pressed (the top of Residences).
 */
export function PriceListForm({ from, collapsed = false, id }: { from: string; collapsed?: boolean; id?: string }) {
  const [state, formAction] = useActionState(requestPriceList, initialState);
  const [open, setOpen] = useState(!collapsed);
  const [meta, setMeta] = useState({ started: "", utm_source: "" });
  const [seen, setSeen] = useState<PriceListFormState>(state);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const uid = useId();
  const doneRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the clock and the address bar can only be read in the browser
    setMeta({ started: String(Date.now()), utm_source: (q.get("utm_source") ?? "").slice(0, 80) });
  }, []);

  if (state !== seen) {
    setSeen(state);
    setErrors(state.status === "error" ? (state.fieldErrors ?? {}) : {});
  }

  useEffect(() => {
    if (state.status !== "success") return;
    trackLead({ form: "price_list" });
    trackMetaEvent(state.meta);
    trackAction("enquiry");
    doneRef.current?.querySelector<HTMLElement>("[data-focus]")?.focus({ preventScroll: true });
  }, [state]);

  if (!open) {
    return (
      <div className={styles.teaser} id={id}>
        <button
          type="button"
          className={styles.teaserButton}
          onClick={() => {
            setOpen(true);
            requestAnimationFrame(() => nameRef.current?.focus());
          }}
        >
          Get today&rsquo;s price list (PDF)
        </button>
        <span className={styles.teaserText}>by email or WhatsApp</span>
      </div>
    );
  }

  if (state.status === "success") {
    const who = state.firstName ? `, ${state.firstName}` : "";
    return (
      <div className={styles.box} id={id} ref={doneRef} role="status">
        <div className="eyebrow">Price list</div>
        <h2 className={styles.title} tabIndex={-1} data-focus>
          {state.sentTo === "email" ? `It’s on its way${who}.` : `Here it is${who}.`}
        </h2>
        <p className={styles.lede}>
          {state.sentTo === "email" ? (
            <>
              We&rsquo;ve emailed today&rsquo;s price list to <strong>{state.email}</strong>. You can also open it now.
            </>
          ) : state.sentTo === "email-failed" ? (
            <>We couldn&rsquo;t email it just now, so our team will send it to you. You can open it now.</>
          ) : (
            <>Open it now. Our team will also send it to you on WhatsApp.</>
          )}
        </p>
        <a className={styles.open} href={PRICE_LIST_PATH} target="_blank" rel="noopener">
          Open the price list (PDF)
        </a>
      </div>
    );
  }

  const err = (key: string) => errors[key] || undefined;
  return (
    <div className={styles.box} id={id}>
      <div className="eyebrow">Price list</div>
      <h2 className={styles.title}>Get today&rsquo;s price list.</h2>
      <p className={styles.lede}>
        Every home still for sale, with its price, the finishes and how to pay, as a PDF to keep or share. We&rsquo;ll email it, or
        leave your WhatsApp number.
      </p>
      <form action={formAction} noValidate className={styles.form}>
        {state.status === "error" && state.message && (
          <p className={styles.formError} role="alert">
            {state.message}
          </p>
        )}
        <div className={styles.fields}>
          <div className={styles.field}>
            <label htmlFor={`${uid}-name`}>Your name</label>
            <input
              ref={nameRef}
              id={`${uid}-name`}
              name="name"
              type="text"
              autoComplete="name"
              required
              aria-invalid={Boolean(err("name"))}
              aria-describedby={err("name") ? `${uid}-name-error` : undefined}
              onChange={() => setErrors((e) => ({ ...e, name: "" }))}
            />
            {err("name") && (
              <p className={styles.fieldError} id={`${uid}-name-error`}>
                {err("name")}
              </p>
            )}
          </div>
          <div className={styles.field}>
            <label htmlFor={`${uid}-contact`}>Email or WhatsApp number</label>
            <input
              id={`${uid}-contact`}
              name="contact"
              type="text"
              autoComplete="email"
              placeholder="Email or +233 24 123 4567"
              required
              aria-invalid={Boolean(err("contact"))}
              aria-describedby={err("contact") ? `${uid}-contact-error` : undefined}
              onChange={() => setErrors((e) => ({ ...e, contact: "" }))}
            />
            {err("contact") && (
              <p className={styles.fieldError} id={`${uid}-contact-error`}>
                {err("contact")}
              </p>
            )}
          </div>
          <SendButton />
        </div>
        <input type="hidden" name="from" value={from} />
        <input type="hidden" name="started" value={meta.started} />
        <input type="hidden" name="utm_source" value={meta.utm_source} />
        <div className={styles.srOnly} aria-hidden="true">
          <label htmlFor={`${uid}-website`}>Leave this empty</label>
          <input type="text" id={`${uid}-website`} name="website_url" tabIndex={-1} autoComplete="off" />
        </div>
        <p className={styles.small}>
          We use your details to send you the price list and to follow up. <a href="/privacy">Privacy</a>
        </p>
      </form>
    </div>
  );
}
