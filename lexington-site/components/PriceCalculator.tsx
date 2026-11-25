"use client";

import { useEffect, useId, useMemo, useState } from "react";

import { FEE_PER_SQM, PLAN_MONTHS, monthlyFee, payFor, type PayMethod, type PlanEvery } from "@/lib/calculator";
import { formatUSD, whatsappUrl } from "@/lib/format";
import styles from "./PriceCalculator.module.css";

export interface CalcHome {
  unitNumber: string;
  /** "One bedroom" */
  kind: string;
  /** "Floor 2", "Ground floor" */
  floor: string;
  areaSqm: number;
  /** "70 sqm · 753 sq ft" */
  size: string;
  /** The price shown for each finish (VAT included while VAT is on). */
  prices: Record<string, number>;
  /** Finishes this home can't have below ("premium" for a penthouse), with the note to show. */
  includedNote: string | null;
  minTier: string | null;
}

export interface CalcOffer {
  fullPct: number | null;
  planPct: number | null;
  /** "30 November", when the offer has a last day. */
  until: string | null;
  /** The offer after it: "From 1 December: 10% off with full payment, or 5% off with a payment plan." */
  nextLine: string | null;
}

const METHODS: Array<{ key: PayMethod; label: string }> = [
  { key: "full", label: "Pay in full" },
  { key: "plan", label: "Payment plan" },
  { key: "mortgage", label: "Mortgage" },
];

/**
 * The price calculator at the top of /invest (Niko, 25 Nov 2026): a home, its finish, and how to pay (in full, a
 * payment plan with monthly or quarterly payments, or a mortgage): the discount, what is paid when, and the estimated
 * monthly building management fee. A link from a home's pop-up opens it on that home (?unit=203B#calculator).
 */
export function PriceCalculator({
  homes,
  tiers,
  offer,
  mortgagePct,
  deposit,
  vatOn,
  contactPhone,
}: {
  homes: CalcHome[];
  tiers: Array<{ key: string; name: string }>;
  offer: CalcOffer | null;
  mortgagePct: number | null;
  deposit: number;
  vatOn: boolean;
  contactPhone: string;
}) {
  const uid = useId();
  const [unit, setUnit] = useState(homes[0]?.unitNumber ?? "");
  const [tier, setTier] = useState(tiers[0]?.key ?? "standard");
  const [method, setMethod] = useState<PayMethod>("plan");
  const [months, setMonths] = useState<number>(12);
  const [every, setEvery] = useState<PlanEvery>("month");

  // A link can pick the home: /invest?unit=203B#calculator (from a home's pop-up on Residences).
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("unit")?.trim().toLowerCase();
    const found = wanted ? homes.find((h) => h.unitNumber.toLowerCase() === wanted) : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the address bar can only be read in the browser
    if (found) setUnit(found.unitNumber);
  }, [homes]);

  const home = homes.find((h) => h.unitNumber === unit) ?? homes[0];
  const kinds = useMemo(() => Array.from(new Set(homes.map((h) => h.kind))), [homes]);
  if (!home) return null;

  const listPrice = home.prices[tier] ?? home.prices[tiers[0]?.key] ?? 0;
  const result = payFor({ listPrice, method, offer, mortgagePct, deposit, months, every });
  const [feeLow, feeHigh] = monthlyFee(home.areaSqm);
  const vat = vatOn ? " incl. VAT" : "";
  const tierName = tiers.find((t) => t.key === tier)?.name ?? "";
  const changeLabel =
    method === "mortgage"
      ? `Mortgage financing (+${result.changePct}%)`
      : result.changePct < 0
        ? `${method === "full" ? "Paying in full" : "Payment plan"} discount (${-result.changePct}%${offer?.until ? `, until ${offer.until}` : ""})`
        : "";
  const howWords =
    method === "full"
      ? "paying in full"
      : method === "plan"
        ? `on a ${months}-month payment plan with ${every === "month" ? "monthly" : "quarterly"} payments`
        : "with a mortgage";
  const whatsappHref = whatsappUrl(
    contactPhone,
    `Hi, I'm interested in ${home.unitNumber} at The Lexington (${home.kind}, ${home.areaSqm} sqm), ${howWords}, ${tierName} finish. Can you tell me more?`
  );

  return (
    <div className={styles.calc}>
      <div className={styles.inputs}>
        <div className={styles.field}>
          <label htmlFor={`${uid}-home`}>Home</label>
          <select id={`${uid}-home`} value={home.unitNumber} onChange={(e) => setUnit(e.target.value)}>
            {kinds.map((k) => (
              <optgroup key={k} label={k}>
                {homes
                  .filter((h) => h.kind === k)
                  .map((h) => (
                    <option key={h.unitNumber} value={h.unitNumber}>
                      {h.unitNumber} · {h.floor} · {h.areaSqm} sqm · {formatUSD(h.prices[tiers[0]?.key] ?? 0)}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </div>

        <fieldset className={styles.group}>
          <legend>Finish</legend>
          <div className={styles.choices}>
            {tiers.map((t) => {
              const below = home.minTier !== null && tiers.findIndex((x) => x.key === t.key) < tiers.findIndex((x) => x.key === home.minTier);
              return (
                <button key={t.key} type="button" className={styles.choice} aria-pressed={tier === t.key} disabled={below} onClick={() => setTier(t.key)}>
                  {t.name}
                </button>
              );
            })}
          </div>
          {home.includedNote && <p className={styles.hint}>{home.includedNote}</p>}
        </fieldset>

        <fieldset className={styles.group}>
          <legend>How you pay</legend>
          <div className={styles.choices}>
            {METHODS.filter((m) => m.key !== "mortgage" || mortgagePct !== null).map((m) => (
              <button key={m.key} type="button" className={styles.choice} aria-pressed={method === m.key} onClick={() => setMethod(m.key)}>
                {m.label}
              </button>
            ))}
          </div>
        </fieldset>

        {method === "plan" && (
          <>
            <fieldset className={styles.group}>
              <legend>Over</legend>
              <div className={styles.choices}>
                {PLAN_MONTHS.map((n) => (
                  <button key={n} type="button" className={styles.choice} aria-pressed={months === n} onClick={() => setMonths(n)}>
                    {n} months
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className={styles.group}>
              <legend>Payments</legend>
              <div className={styles.choices}>
                <button type="button" className={styles.choice} aria-pressed={every === "month"} onClick={() => setEvery("month")}>
                  Monthly
                </button>
                <button type="button" className={styles.choice} aria-pressed={every === "quarter"} onClick={() => setEvery("quarter")}>
                  Quarterly
                </button>
              </div>
            </fieldset>
          </>
        )}
      </div>

      <div className={styles.result} aria-live="polite">
        <div className={styles.home}>
          <span className={styles.unit}>{home.unitNumber}</span>
          <span className={styles.meta}>
            {home.kind} · {home.floor} · {home.size}
          </span>
        </div>

        <dl className={styles.rows}>
          <div>
            <dt>List price ({tierName} finish)</dt>
            <dd>
              {formatUSD(result.listPrice)}
              {vat && <small>{vat}</small>}
            </dd>
          </div>
          {changeLabel && (
            <div className={result.changeAmount < 0 ? styles.saving : styles.extra}>
              <dt>{changeLabel}</dt>
              <dd>
                {result.changeAmount < 0 ? "−" : "+"}
                {formatUSD(Math.abs(result.changeAmount))}
              </dd>
            </div>
          )}
          <div className={styles.total}>
            <dt>{method === "mortgage" ? "Price with a mortgage" : "Your price"}</dt>
            <dd>{formatUSD(result.price)}</dd>
          </div>
        </dl>

        <ol className={styles.steps}>
          <li>
            <span className={styles.when}>Today</span>
            <span className={styles.what}>
              {formatUSD(result.deposit)} reservation{vatOn ? " (VAT included)" : ""}: the standard deposit, which holds your home.
            </span>
          </li>
          {method === "full" && (
            <li>
              <span className={styles.when}>Then</span>
              <span className={styles.what}>The balance of {formatUSD(result.balance)}.</span>
            </li>
          )}
          {method === "plan" && result.payments && (
            <li>
              <span className={styles.when}>Then</span>
              <span className={styles.what}>
                <strong>
                  {formatUSD(result.payments.amount)} a {result.payments.every === "month" ? "month" : "quarter"}
                </strong>{" "}
                for {months} months ({result.payments.count} payments
                {result.payments.last !== result.payments.amount ? `, the last one ${formatUSD(result.payments.last)}` : ""}).
              </span>
            </li>
          )}
          {method === "mortgage" && (
            <li>
              <span className={styles.when}>Then</span>
              <span className={styles.what}>
                {formatUSD(result.balance)} through your mortgage. Your bank sets the monthly repayments.
              </span>
            </li>
          )}
        </ol>

        <div className={styles.fee}>
          <span className={styles.feeLabel}>Building management fee, estimated</span>
          <span className={styles.feeValue}>
            {formatUSD(feeLow)}–{formatUSD(feeHigh)} a month
          </span>
          <span className={styles.feeNote}>
            About US${FEE_PER_SQM.low}–{FEE_PER_SQM.high} per sqm a month for {home.areaSqm} sqm; set each year with the building&rsquo;s budget.
          </span>
        </div>

        <div className={styles.actions}>
          <a className={styles.reserve} href={`/reserve?unit=${encodeURIComponent(home.unitNumber)}`}>
            Reserve {home.unitNumber}
          </a>
          <a className={styles.whatsapp} href={whatsappHref} target="_blank" rel="noopener noreferrer">
            Ask about it on WhatsApp
          </a>
        </div>

        <p className={styles.small}>
          {offer?.nextLine ? `${offer.nextLine} ` : ""}A guide to the figures: your sale agreement sets the final amounts and dates. Amounts are rounded to the
          dollar.
        </p>
      </div>
    </div>
  );
}
