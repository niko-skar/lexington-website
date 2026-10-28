"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";

import { submitReservation, type ReserveFormState } from "@/lib/actions/reserve";
import { trackLead } from "@/lib/analytics";
import { formatFloor, formatUSD } from "@/lib/format";
import { formatArea } from "@/lib/area";
import { useAreaUnit } from "./useAreaUnit";
import {
  BUYING_AS,
  CONTACT_VIA,
  COUNTRIES,
  HEARD,
  OTHER_COUNTRY,
  PAYMENTS,
  PURPOSES,
  RESERVATION_FEE_USD,
  STEPS,
  TIMELINES,
  UNIT_TYPES,
  UNSURE_TYPE,
  VIEWINGS,
  labelOf,
  unitTypeFor,
  type Option,
} from "@/lib/reservation/config";
import { trackAction } from "@/lib/visits/client";
import { feeVatSuffix, inclVatSuffix, withVat, type Vat } from "@/lib/vat";
import buttonStyles from "./Button.module.css";
import styles from "./ReserveForm.module.css";

export interface ReserveUnit {
  unitNumber: string;
  bedroomType: string;
  floor: number;
  areaSqm: number;
  priceUSD: number;
}

interface Values {
  name: string;
  email: string;
  phone: string;
  country: string;
  countryOther: string;
  city: string;
  contactVia: string;
  unitType: string;
  unit: string;
  purpose: string;
  timeline: string;
  viewing: string;
  payment: string;
  buyingAs: string;
  coBuyer: string;
  company: string;
  heard: string;
  note: string;
  consent: boolean;
}

const EMPTY: Values = {
  name: "",
  email: "",
  phone: "",
  country: "",
  countryOther: "",
  city: "",
  contactVia: "whatsapp",
  unitType: "",
  unit: "",
  purpose: "",
  timeline: "",
  viewing: "",
  payment: "",
  buyingAs: "self",
  coBuyer: "",
  company: "",
  heard: "",
  note: "",
  consent: false,
};

// Sent with the answers but never typed: when the form was opened (the server uses it
// to tell a person from a script) and which advert or link brought them here.
const META_FIELDS = ["started", "utm_source", "utm_medium", "utm_campaign", "utm_content"] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[\d\s+().-]+$/;

type Errors = Record<string, string>;
type StringKey = Exclude<keyof Values, "consent">;

// What each step needs before "Next" lets the visitor on. The server checks all
// of it again; this is only so a mistake is caught while they're still looking.
function validateStep(step: number, v: Values): Errors {
  const e: Errors = {};
  if (step === 1) {
    if (v.name.trim().length < 2) e.name = "Please enter your full name.";
    if (!EMAIL_RE.test(v.email.trim())) e.email = "Please enter a valid email address. The form is sent there.";
    const digits = v.phone.replace(/\D/g, "");
    if (!PHONE_RE.test(v.phone.trim()) || digits.length < 7 || digits.length > 15) {
      e.phone = "Please enter your phone or WhatsApp number, with the country code.";
    }
    if (!v.country) e.country = "Please choose where you live.";
    else if (v.country === OTHER_COUNTRY && v.countryOther.trim().length < 2) e.countryOther = "Please tell us which country.";
  }
  if (step === 2) {
    if (!v.unitType) e.unitType = "Please choose a type of residence, or tell us you'd like advice.";
    if (!v.purpose) e.purpose = "Please tell us what the residence is for.";
  }
  if (step === 3) {
    if (!v.payment) e.payment = "Please tell us how you expect to pay.";
    if (v.buyingAs === "company" && v.company.trim().length < 2) e.company = "Please give the company's name.";
  }
  if (step === 4 && !v.consent) e.consent = "Please tick the box so we can use your details to deal with your reservation.";
  return e;
}

const initialState: ReserveFormState = { status: "idle", message: "" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`${buttonStyles.btn} ${buttonStyles.clay} ${styles.primary}`}>
      {pending ? "Sending…" : "Email me the reservation form"}
    </button>
  );
}

function ErrorText({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p className={styles.fieldError} id={`${id}-error`} role="alert">
      {message}
    </p>
  );
}

interface ReserveFormProps {
  /** Only the residences that are available right now. */
  units: ReserveUnit[];
  contactPhone: string;
  contactEmail: string;
  whatsappHref: string;
  /** VAT on the prices (Site settings): the fee, which has VAT in it, then says "VAT included". */
  vat: Vat;
}

export function ReserveForm({ units, contactPhone, contactEmail, whatsappHref, vat }: ReserveFormProps) {
  const [state, formAction] = useActionState(submitReservation, initialState);
  const [step, setStep] = useState(1);
  const [values, setValues] = useState<Values>(EMPTY);
  const areaUnit = useAreaUnit();
  const [errors, setErrors] = useState<Errors>({});
  const [seen, setSeen] = useState<ReserveFormState>(state);
  // Which advert or link brought them here (utm_ parts only), and when the form
  // was opened: the server uses the time to tell a person from a script.
  const [meta, setMeta] = useState<Record<(typeof META_FIELDS)[number], string>>({
    started: "",
    utm_source: "",
    utm_medium: "",
    utm_campaign: "",
    utm_content: "",
  });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const shownStep = useRef(1);

  // The clock and the address bar can only be read in the browser, once the page has loaded.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
    setMeta({
      started: String(Date.now()),
      utm_source: (q.get("utm_source") ?? "").slice(0, 80),
      utm_medium: (q.get("utm_medium") ?? "").slice(0, 80),
      utm_campaign: (q.get("utm_campaign") ?? "").slice(0, 80),
      utm_content: (q.get("utm_content") ?? "").slice(0, 80),
    });
  }, []);

  // ?unit=205B (or ?type=One Bedroom) picks the residence.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const unitParam = q.get("unit")?.trim();
    const typeParam = q.get("type")?.trim();
    const wanted = unitParam ? units.find((u) => u.unitNumber.toLowerCase() === unitParam.toLowerCase()) : undefined;
    const wantedType = wanted?.bedroomType ?? (UNIT_TYPES.some((t) => t.key === typeParam) ? typeParam : undefined);
    if (wanted || wantedType) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the address bar is only possible in the browser, after the page has loaded
      setValues((v) => ({ ...v, unitType: wantedType ?? v.unitType, unit: wanted?.unitNumber ?? "" }));
    }
  }, [units]);

  // A server answer arrives: go back to the step it complains about, with its messages.
  if (state !== seen) {
    setSeen(state);
    if (state.status === "error") {
      if (state.step) setStep(state.step);
      setErrors(state.fieldErrors ?? {});
    }
  }

  // The server says the request went through: tell the analytics once, and bring the thank-you into view.
  useEffect(() => {
    if (state.status === "success") {
      trackLead({ unit: state.unit, form: "reservation" });
      trackAction("enquiry");
      doneRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      doneRef.current?.querySelector("h2")?.focus({ preventScroll: true });
    }
  }, [state]);

  // After "Next"/"Back", put the reader at the new step's heading (not on first load).
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    headingRef.current?.focus({ preventScroll: true });
    const top = topRef.current?.getBoundingClientRect().top ?? 0;
    if (top < 0 || top > 200) topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [step]);

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: "" } : e));
  };

  const goNext = () => {
    const found = validateStep(step, values);
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first) {
      document.getElementById(`field-${first}`)?.focus();
      return;
    }
    setStep((s) => Math.min(4, s + 1));
  };

  const unitsOfType = useMemo(
    () => units.filter((u) => u.bedroomType === values.unitType),
    [units, values.unitType]
  );
  const chosen = units.find((u) => u.unitNumber === values.unit);

  if (state.status === "success") {
    return (
      <div className={styles.done} role="status" ref={doneRef}>
        <div className="eyebrow">{state.emailed ? "On its way" : "Request received"}</div>
        <h2 className={styles.doneTitle} tabIndex={-1}>
          Thank you, {state.firstName}.
        </h2>
        {state.emailed ? (
          <>
            <p className={styles.doneLede}>
              We&rsquo;ve emailed your reservation fee form to <strong>{state.email}</strong>. It should be in your inbox
              in a minute or two. If you can&rsquo;t see it, check your spam folder.
            </p>
            <ol className={styles.doneSteps}>
              <li>Open the form and check your name and details.</li>
              <li>
                One of our sales advisors will contact you to agree how you would like to pay the US$
                {RESERVATION_FEE_USD.toLocaleString("en-US")} reservation fee{feeVatSuffix(vat)}, and will send you the bank details that match.
              </li>
              <li>
                Before you send any money, phone us on <a href={`tel:${contactPhone.replace(/[^\d+]/g, "")}`}>{contactPhone}</a>{" "}
                to confirm the bank details. Then email your proof of payment to{" "}
                <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
              </li>
              <li>We&rsquo;ll confirm your residence in writing, and your payment receipt follows once the payment has arrived.</li>
            </ol>
          </>
        ) : (
          <p className={styles.doneLede}>{state.message}</p>
        )}
        <div className={styles.doneActions}>
          <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className={`${buttonStyles.btn} ${buttonStyles.brass}`}>
            Message us on WhatsApp
          </a>
          <Link href="/residences" className={`${buttonStyles.btn} ${buttonStyles.outlineDark}`}>
            Back to the residences
          </Link>
        </div>
      </div>
    );
  }

  const err = (key: string) => errors[key] || undefined;
  const radio = (
    name: StringKey,
    option: Option,
    extra?: { onPick?: () => void; detail?: string }
  ) => (
    <label key={option.key} className={`${styles.choice} ${values[name] === option.key ? styles.choiceOn : ""}`}>
      <input
        type="radio"
        name={name}
        value={option.key}
        checked={values[name] === option.key}
        onChange={() => {
          set(name, option.key);
          extra?.onPick?.();
        }}
      />
      <span>{option.label}</span>
      {extra?.detail && <small>{extra.detail}</small>}
    </label>
  );

  const reviewRows: Array<[string, string, number]> = [
    ["Name", values.name.trim(), 1],
    ["Email", values.email.trim(), 1],
    ["Phone / WhatsApp", values.phone.trim(), 1],
    [
      "Lives in",
      [values.city.trim(), values.country === OTHER_COUNTRY ? values.countryOther.trim() : values.country]
        .filter(Boolean)
        .join(", "),
      1,
    ],
    [
      "Residence",
      chosen
        ? `Unit ${chosen.unitNumber}: ${unitTypeFor(chosen.bedroomType)?.fact ?? chosen.bedroomType}`
        : values.unitType === UNSURE_TYPE
          ? "Not sure: we'll recommend one"
          : values.unitType
            ? `${unitTypeFor(values.unitType)?.fact ?? values.unitType}: we'll confirm the unit with you`
            : "—",
      2,
    ],
    ["It is for", labelOf(PURPOSES, values.purpose) ?? "—", 2],
    ["Paying", labelOf(PAYMENTS, values.payment) ?? "—", 3],
  ];

  return (
    <div ref={topRef} className={styles.wrap}>
      {/* Progress */}
      <ol className={styles.progress} aria-label="Progress">
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={`${styles.pstep} ${i + 1 === step ? styles.pstepNow : ""} ${i + 1 < step ? styles.pstepDone : ""}`}
            aria-current={i + 1 === step ? "step" : undefined}
          >
            <span className={styles.pnum}>{i + 1 < step ? "✓" : i + 1}</span>
            <span className={styles.plabel}>{label}</span>
          </li>
        ))}
      </ol>
      <p className={styles.mobileStep}>
        Step {step} of {STEPS.length}: {STEPS[step - 1]}
      </p>

      <form
        action={formAction}
        noValidate
        onSubmit={(e) => {
          // The last step's one rule (the tick box) is checked here too, so nobody waits for the server to be told off.
          const found = step === 4 ? validateStep(4, values) : {};
          if (Object.keys(found).length > 0) {
            e.preventDefault();
            setErrors(found);
            document.getElementById("field-consent")?.focus();
          }
        }}
        onKeyDown={(e) => {
          // Enter in a text box means "next", not "send the form" half way through.
          if (e.key === "Enter" && step < 4 && (e.target as HTMLElement).tagName === "INPUT") {
            e.preventDefault();
            goNext();
          }
        }}
      >
        {state.status === "error" && !state.step && (
          <p className={styles.formError} role="alert">
            {state.message}
          </p>
        )}

        {/* ------------------------------- step 1 ------------------------------- */}
        <fieldset className={styles.step} hidden={step !== 1}>
          <legend className={styles.srOnly}>First, a little about you</legend>
          <h2 className={styles.stepTitle} tabIndex={-1} ref={step === 1 ? headingRef : undefined}>
            First, a little about you
          </h2>
          <div className={styles.field}>
            <label htmlFor="field-name">Full name</label>
            <input
              id="field-name"
              name="name"
              type="text"
              autoComplete="name"
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
              aria-invalid={Boolean(err("name"))}
              aria-describedby={err("name") ? "name-error" : undefined}
            />
            <ErrorText id="name" message={err("name")} />
          </div>
          <div className={styles.field}>
            <label htmlFor="field-email">Email</label>
            <input
              id="field-email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={values.email}
              onChange={(e) => set("email", e.target.value)}
              aria-invalid={Boolean(err("email"))}
              aria-describedby={err("email") ? "email-error" : "email-hint"}
            />
            <p className={styles.hint} id="email-hint">The reservation form is emailed to this address.</p>
            <ErrorText id="email" message={err("email")} />
          </div>
          <div className={styles.field}>
            <label htmlFor="field-phone">Phone / WhatsApp</label>
            <input
              id="field-phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              placeholder="+233 24 000 0000"
              value={values.phone}
              onChange={(e) => set("phone", e.target.value)}
              aria-invalid={Boolean(err("phone"))}
              aria-describedby={err("phone") ? "phone-error" : undefined}
            />
            <ErrorText id="phone" message={err("phone")} />
          </div>
          <div className={styles.twoCol}>
            <div className={styles.field}>
              <label htmlFor="field-country">Where do you live?</label>
              <select
                id="field-country"
                name="country"
                value={values.country}
                onChange={(e) => set("country", e.target.value)}
                aria-invalid={Boolean(err("country"))}
                aria-describedby={err("country") ? "country-error" : undefined}
              >
                <option value="" disabled>
                  Choose a country
                </option>
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value={OTHER_COUNTRY}>{OTHER_COUNTRY}</option>
              </select>
              <ErrorText id="country" message={err("country")} />
            </div>
            <div className={styles.field}>
              <label htmlFor="field-city">City (optional)</label>
              <input
                id="field-city"
                name="city"
                type="text"
                autoComplete="address-level2"
                value={values.city}
                onChange={(e) => set("city", e.target.value)}
              />
            </div>
          </div>
          {values.country === OTHER_COUNTRY && (
            <div className={styles.field}>
              <label htmlFor="field-countryOther">Which country?</label>
              <input
                id="field-countryOther"
                name="countryOther"
                type="text"
                value={values.countryOther}
                onChange={(e) => set("countryOther", e.target.value)}
                aria-invalid={Boolean(err("countryOther"))}
                aria-describedby={err("countryOther") ? "countryOther-error" : undefined}
              />
              <ErrorText id="countryOther" message={err("countryOther")} />
            </div>
          )}
          <div className={styles.field}>
            <span className={styles.groupLabel} id="contactVia-label">
              How should we reach you?
            </span>
            <div className={styles.choices} role="radiogroup" aria-labelledby="contactVia-label">
              {CONTACT_VIA.map((o) => radio("contactVia", o))}
            </div>
          </div>
        </fieldset>

        {/* ------------------------------- step 2 ------------------------------- */}
        <fieldset className={styles.step} hidden={step !== 2}>
          <legend className={styles.srOnly}>What are you looking for?</legend>
          <h2 className={styles.stepTitle} tabIndex={-1} ref={step === 2 ? headingRef : undefined}>
            What are you looking for?
          </h2>

          <div className={styles.field}>
            <span className={styles.groupLabel} id="unitType-label">
              Which residence?
            </span>
            <div className={styles.choices} role="radiogroup" aria-labelledby="unitType-label" id="field-unitType" tabIndex={-1}>
              {UNIT_TYPES.map((t) => {
                const count = units.filter((u) => u.bedroomType === t.key).length;
                return (
                  <label
                    key={t.key}
                    className={`${styles.choice} ${values.unitType === t.key ? styles.choiceOn : ""} ${count === 0 ? styles.choiceOff : ""}`}
                  >
                    <input
                      type="radio"
                      name="unitType"
                      value={t.key}
                      checked={values.unitType === t.key}
                      disabled={count === 0}
                      onChange={() => {
                        set("unitType", t.key);
                        set("unit", "");
                      }}
                    />
                    <span>{t.label}</span>
                    <small>{count === 0 ? "None available" : `${count} available`}</small>
                  </label>
                );
              })}
              <label className={`${styles.choice} ${values.unitType === UNSURE_TYPE ? styles.choiceOn : ""}`}>
                <input
                  type="radio"
                  name="unitType"
                  value={UNSURE_TYPE}
                  checked={values.unitType === UNSURE_TYPE}
                  onChange={() => {
                    set("unitType", UNSURE_TYPE);
                    set("unit", "");
                  }}
                />
                <span>Not sure yet</span>
                <small>We&rsquo;ll recommend one</small>
              </label>
            </div>
            <ErrorText id="unitType" message={err("unitType")} />
          </div>

          {values.unitType && values.unitType !== UNSURE_TYPE && unitsOfType.length > 0 && (
            <div className={styles.field}>
              <span className={styles.groupLabel} id="unit-label">
                Pick a unit, or let us choose
              </span>
              <div className={styles.units} role="radiogroup" aria-labelledby="unit-label" id="field-unit" tabIndex={-1}>
                <label className={`${styles.unitRow} ${values.unit === "" ? styles.unitOn : ""}`}>
                  <input type="radio" name="unit" value="" checked={values.unit === ""} onChange={() => set("unit", "")} />
                  <span className={styles.unitMain}>Any available {unitTypeFor(values.unitType)?.label.toLowerCase()}</span>
                  <span className={styles.unitMeta}>We&rsquo;ll confirm the unit in writing</span>
                </label>
                {unitsOfType.map((u) => (
                  <label key={u.unitNumber} className={`${styles.unitRow} ${values.unit === u.unitNumber ? styles.unitOn : ""}`}>
                    <input
                      type="radio"
                      name="unit"
                      value={u.unitNumber}
                      checked={values.unit === u.unitNumber}
                      onChange={() => set("unit", u.unitNumber)}
                    />
                    <span className={styles.unitMain}>Unit {u.unitNumber}</span>
                    <span className={styles.unitMeta}>
                      {u.floor === 0 ? "Ground floor" : `Floor ${formatFloor(u.floor)}`} · {formatArea(u.areaSqm, areaUnit)} · from {formatUSD(withVat(u.priceUSD, vat))}{inclVatSuffix(vat)}
                    </span>
                  </label>
                ))}
              </div>
              <ErrorText id="unit" message={err("unit")} />
            </div>
          )}

          <div className={styles.field}>
            <span className={styles.groupLabel} id="purpose-label">
              What is it for?
            </span>
            <div className={styles.choices} role="radiogroup" aria-labelledby="purpose-label" id="field-purpose" tabIndex={-1}>
              {PURPOSES.map((o) => radio("purpose", o))}
            </div>
            <ErrorText id="purpose" message={err("purpose")} />
          </div>

          <div className={styles.field}>
            <span className={styles.groupLabel} id="timeline-label">
              When would you like to reserve? <em>(optional)</em>
            </span>
            <div className={styles.choices} role="radiogroup" aria-labelledby="timeline-label">
              {TIMELINES.map((o) => radio("timeline", o))}
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.groupLabel} id="viewing-label">
              Would you like to see it first? <em>(optional)</em>
            </span>
            <div className={styles.choices} role="radiogroup" aria-labelledby="viewing-label">
              {VIEWINGS.map((o) => radio("viewing", o))}
            </div>
          </div>
        </fieldset>

        {/* ------------------------------- step 3 ------------------------------- */}
        <fieldset className={styles.step} hidden={step !== 3}>
          <legend className={styles.srOnly}>How will you pay?</legend>
          <h2 className={styles.stepTitle} tabIndex={-1} ref={step === 3 ? headingRef : undefined}>
            How will you pay?
          </h2>

          <div className={styles.field}>
            <span className={styles.groupLabel} id="payment-label">
              After the reservation fee, you expect to
            </span>
            <div className={styles.choices} role="radiogroup" aria-labelledby="payment-label" id="field-payment" tabIndex={-1}>
              {PAYMENTS.map((o) => radio("payment", o))}
            </div>
            <ErrorText id="payment" message={err("payment")} />
          </div>

          <div className={styles.field}>
            <span className={styles.groupLabel} id="buyingAs-label">
              Who is buying?
            </span>
            <div className={styles.choices} role="radiogroup" aria-labelledby="buyingAs-label">
              {BUYING_AS.map((o) => radio("buyingAs", o))}
            </div>
          </div>

          {values.buyingAs === "joint" && (
            <div className={styles.field}>
              <label htmlFor="field-coBuyer">Their full name (optional)</label>
              <input id="field-coBuyer" name="coBuyer" type="text" value={values.coBuyer} onChange={(e) => set("coBuyer", e.target.value)} />
            </div>
          )}
          {values.buyingAs === "company" && (
            <div className={styles.field}>
              <label htmlFor="field-company">Company name</label>
              <input
                id="field-company"
                name="company"
                type="text"
                value={values.company}
                onChange={(e) => set("company", e.target.value)}
                aria-invalid={Boolean(err("company"))}
                aria-describedby={err("company") ? "company-error" : undefined}
              />
              <ErrorText id="company" message={err("company")} />
            </div>
          )}

          <div className={styles.field}>
            <label htmlFor="field-heard">How did you hear about us? (optional)</label>
            <select id="field-heard" name="heard" value={values.heard} onChange={(e) => set("heard", e.target.value)}>
              <option value="">Choose one</option>
              {HEARD.map((h) => (
                <option key={h.key} value={h.key}>
                  {h.label}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label htmlFor="field-note">Anything else we should know? (optional)</label>
            <textarea
              id="field-note"
              name="note"
              rows={4}
              maxLength={1500}
              placeholder="Questions, timing, a particular floor or view…"
              value={values.note}
              onChange={(e) => set("note", e.target.value)}
            />
          </div>
        </fieldset>

        {/* ------------------------------- step 4 ------------------------------- */}
        <fieldset className={styles.step} hidden={step !== 4}>
          <legend className={styles.srOnly}>Check your answers</legend>
          <h2 className={styles.stepTitle} tabIndex={-1} ref={step === 4 ? headingRef : undefined}>
            Check your answers
          </h2>

          <dl className={styles.review}>
            {reviewRows.map(([label, value, atStep]) => (
              <div key={label} className={styles.reviewRow}>
                <dt>{label}</dt>
                <dd>{value || "—"}</dd>
                <button type="button" className={styles.change} onClick={() => setStep(atStep)} aria-label={`Change ${label.toLowerCase()}`}>
                  Change
                </button>
              </div>
            ))}
          </dl>

          <div className={styles.feeBox}>
            <div className="eyebrow">Reservation fee</div>
            <p className={styles.feeAmount}>US${RESERVATION_FEE_USD.toLocaleString("en-US")}</p>
            {vat.on && <p className={styles.feeVat}>VAT included</p>}
            <p>
              When you press the button we email you the reservation fee form. A sales advisor then agrees with you how
              you would like to pay and sends you the bank details. Nothing is charged on this website.
            </p>
          </div>

          <div className={styles.consent}>
            <label className={styles.check}>
              <input
                id="field-consent"
                name="consent"
                value="yes"
                type="checkbox"
                checked={values.consent}
                onChange={(e) => set("consent", e.target.checked)}
                aria-invalid={Boolean(err("consent"))}
                aria-describedby={err("consent") ? "consent-error" : undefined}
              />
              <span>
                I agree that The Lexington may use these details to deal with my reservation and to contact me about it. See the{" "}
                <Link href="/privacy" target="_blank">
                  privacy policy
                </Link>
                .
              </span>
            </label>
            <ErrorText id="consent" message={err("consent")} />
          </div>
        </fieldset>

        {META_FIELDS.map((k) => (
          <input key={k} type="hidden" name={k} value={meta[k]} readOnly />
        ))}

        {/* Honeypot: invisible to people (off-screen, not reachable by tab); a script that fills every box fills this too. */}
        <div style={{ position: "absolute", left: "-9999px", top: "auto" }} aria-hidden="true">
          <label htmlFor="website_url">Leave this empty</label>
          <input type="text" id="website_url" name="website_url" tabIndex={-1} autoComplete="off" />
        </div>

        <div className={styles.actions}>
          {step > 1 ? (
            <button type="button" className={`${buttonStyles.btn} ${buttonStyles.outlineDark}`} onClick={() => setStep((s) => Math.max(1, s - 1))}>
              Back
            </button>
          ) : (
            <span />
          )}
          {step < 4 ? (
            <button type="button" className={`${buttonStyles.btn} ${buttonStyles.clay} ${styles.primary}`} onClick={goNext}>
              Next
            </button>
          ) : (
            <SubmitButton />
          )}
        </div>
        {state.status === "error" && state.step && !Object.values(errors).includes(state.message) && (
          <p className={styles.formError} role="alert">
            {state.message}
          </p>
        )}
        <p className={styles.note}>
          Your details are sent to Skarlatos &amp; Son and kept so we can follow up with you. Questions? Call{" "}
          <a href={`tel:${contactPhone.replace(/[^\d+]/g, "")}`}>{contactPhone}</a>.
        </p>
      </form>
    </div>
  );
}
