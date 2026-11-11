"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { submitVisit, type VisitFormState } from "@/lib/actions/visit";
import { trackLead } from "@/lib/analytics";
import { VISIT_INTERESTS, dayLabel, rangeLabel, slotDay, slotLabel, type SlotKey } from "@/lib/siteVisits/shared";
import { trackAction } from "@/lib/visits/client";
import buttonStyles from "../Button.module.css";
import f from "../ReserveForm.module.css";
import { SlotPicker } from "./SlotPicker";
import s from "./Visit.module.css";

const initialState: VisitFormState = { status: "idle", message: "" };

function SubmitButton({ ready }: { ready: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-disabled={!ready} className={`${buttonStyles.btn} ${buttonStyles.clay} ${f.primary}`}>
      {pending ? "Booking…" : "Book my visit"}
    </button>
  );
}

function ErrorText({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p className={f.fieldError} id={`${id}-error`} role="alert">
      {message}
    </p>
  );
}

/** The booking page's form (/visit): a time, then who is coming, then "Book my visit". */
export function VisitBooker({
  free: initialFree,
  nowMs,
  address,
  mapUrl,
  whatsappHref,
}: {
  free: SlotKey[];
  nowMs: number;
  address: string;
  mapUrl: string;
  whatsappHref: string;
}) {
  const [state, formAction] = useActionState(submitVisit, initialState);
  const [free, setFree] = useState<SlotKey[]>(initialFree);
  const [slot, setSlot] = useState("");
  const [interest, setInterest] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [seen, setSeen] = useState<VisitFormState>(state);
  const [meta, setMeta] = useState({ started: "", utm_source: "" });
  const doneRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);

  // When the page was opened (the server tells a person from a script by it) and the advert that brought them.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the clock and the address bar can only be read in the browser
    setMeta({ started: String(Date.now()), utm_source: (q.get("utm_source") ?? "").slice(0, 80) });
  }, []);

  // A server answer: its messages under the fields, and a time that has just gone off the list.
  if (state !== seen) {
    setSeen(state);
    if (state.status === "error") {
      setErrors(state.fieldErrors ?? {});
      if (state.fieldErrors?.slot && slot) {
        setFree((list) => list.filter((k) => k !== slot));
        setSlot("");
      }
    }
  }

  useEffect(() => {
    if (state.status === "success") {
      trackLead({ form: "site_visit" });
      trackAction("enquiry");
      doneRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      doneRef.current?.querySelector("h2")?.focus({ preventScroll: true });
    } else if (state.status === "error") {
      topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [state]);

  if (state.status === "success") {
    const b = state.booked;
    return (
      <div className={f.done} role="status" ref={doneRef}>
        <div className="eyebrow">Booked</div>
        <h2 className={f.doneTitle} tabIndex={-1}>
          {b ? `See you on ${dayLabel(slotDay(b.slot)).split(" ")[0]}, ${b.firstName}.` : "Thank you."}
        </h2>
        {b && (
          <>
            <dl className={s.facts}>
              <dt>When</dt>
              <dd>
                {dayLabel(slotDay(b.slot))}, {rangeLabel(b.slot)} <span className={s.muted}>(Accra time)</span>
              </dd>
              <dt>Where</dt>
              <dd>
                {address}.{" "}
                <a href={mapUrl} target="_blank" rel="noopener noreferrer">
                  Open the map
                </a>
              </dd>
            </dl>
            <p className={f.doneLede}>
              {b.emailed ? (
                <>
                  We&rsquo;ve emailed the details to <strong>{b.email}</strong>, and we&rsquo;ll send you a reminder the day before.
                </>
              ) : (
                <>Our team will be in touch on WhatsApp before your visit.</>
              )}{" "}
              A visit takes about an hour. It&rsquo;s a building site, so closed shoes are best.
            </p>
            <div className={f.doneActions}>
              <a href={b.icsUrl} className={`${buttonStyles.btn} ${buttonStyles.brass}`}>
                Add to my calendar
              </a>
              <a href={b.manageUrl} className={`${buttonStyles.btn} ${buttonStyles.outlineDark}`}>
                Change or cancel
              </a>
            </div>
          </>
        )}
      </div>
    );
  }

  const err = (key: string) => errors[key] || undefined;
  const clear = (key: string) => setErrors((e) => (e[key] ? { ...e, [key]: "" } : e));

  return (
    <div className={f.wrap} ref={topRef}>
      <form action={formAction} noValidate>
        {state.status === "error" && state.message && (
          <p className={f.formError} role="alert">
            {state.message}
          </p>
        )}
        {state.status === "error" && state.alternatives && state.alternatives.length > 0 && (
          <div className={s.alts}>
            <span className={f.groupLabel}>Free instead</span>
            <div className={f.choices}>
              {state.alternatives.map((k) => (
                <button key={k} type="button" className={`${f.choice} ${slot === k ? f.choiceOn : ""}`} onClick={() => (setSlot(k), clear("slot"))}>
                  {slotLabel(k, true)}
                </button>
              ))}
            </div>
          </div>
        )}

        <h2 className={f.stepTitle}>1. Pick a day and a time</h2>
        <SlotPicker
          free={free}
          value={slot}
          nowMs={nowMs}
          onChange={(k) => {
            setSlot(k);
            clear("slot");
          }}
          error={err("slot")}
        />
        <input type="hidden" name="slot" value={slot} />

        <h2 className={`${f.stepTitle} ${s.second}`}>2. Who is coming</h2>
        <div className={f.twoCol}>
          <div className={f.field}>
            <label htmlFor="v-name">Your name</label>
            <input id="v-name" name="name" type="text" autoComplete="name" required aria-invalid={Boolean(err("name"))} onChange={() => clear("name")} />
            <ErrorText id="v-name" message={err("name")} />
          </div>
          <div className={f.field}>
            <label htmlFor="v-phone">Phone or WhatsApp</label>
            <input id="v-phone" name="phone" type="tel" autoComplete="tel" placeholder="+233 24 123 4567" required aria-invalid={Boolean(err("phone"))} onChange={() => clear("phone")} />
            <ErrorText id="v-phone" message={err("phone")} />
          </div>
        </div>
        <div className={f.twoCol}>
          <div className={f.field}>
            <label htmlFor="v-email">
              Email <span className={s.optional}>(for your confirmation and a reminder)</span>
            </label>
            <input id="v-email" name="email" type="email" autoComplete="email" aria-invalid={Boolean(err("email"))} onChange={() => clear("email")} />
            <ErrorText id="v-email" message={err("email")} />
          </div>
          <div className={f.field}>
            <label htmlFor="v-people">How many of you</label>
            <select id="v-people" name="people" defaultValue="" aria-invalid={Boolean(err("people"))} onChange={() => clear("people")}>
              <option value="">Choose…</option>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? "Just me" : `${n} people`}
                </option>
              ))}
            </select>
            <ErrorText id="v-people" message={err("people")} />
          </div>
        </div>
        <div className={f.field}>
          <span className={f.groupLabel}>
            What would you like to see? <em>(optional)</em>
          </span>
          <div className={f.choices} role="radiogroup">
            {VISIT_INTERESTS.map((o) => (
              <label key={o} className={`${f.choice} ${interest === o ? f.choiceOn : ""}`}>
                <input type="radio" name="interest" value={o} checked={interest === o} onChange={() => setInterest(o)} />
                {o}
              </label>
            ))}
          </div>
          <ErrorText id="v-interest" message={err("interest")} />
        </div>
        <div className={f.field}>
          <label htmlFor="v-note">
            Anything we should know? <span className={s.optional}>(optional)</span>
          </label>
          <textarea id="v-note" name="note" maxLength={1000} rows={3} />
        </div>

        <input type="hidden" name="started" value={meta.started} />
        <input type="hidden" name="utm_source" value={meta.utm_source} />
        <div className={f.srOnly} aria-hidden="true">
          <label htmlFor="website_url">Leave this empty</label>
          <input type="text" id="website_url" name="website_url" tabIndex={-1} autoComplete="off" />
        </div>

        <div className={f.actions}>
          <span className={s.small}>
            We use your details only to arrange your visit. <a href="/privacy">Privacy</a>
          </span>
          <SubmitButton ready={Boolean(slot)} />
        </div>
        <p className={f.note}>
          Can&rsquo;t find a time that suits you?{" "}
          <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
            Message us on WhatsApp
          </a>{" "}
          and we&rsquo;ll arrange one.
        </p>
      </form>
    </div>
  );
}
