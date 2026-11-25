"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { FEE_PER_SQM, PLAN_MONTHS, monthlyFee, payFor, type PayMethod, type PlanEvery } from "@/lib/calculator";
import type { CalcHome, CalcOffer } from "@/lib/calculatorHomes";
import { formatUSD, whatsappUrl } from "@/lib/format";
import styles from "./PriceCalculator.module.css";

/** How many homes can be compared at once (as many as Residences' Compare). */
export const MAX_HOMES = 4;

const METHODS: Array<{ key: PayMethod; label: string }> = [
  { key: "full", label: "Pay in full" },
  { key: "plan", label: "Payment plan" },
  { key: "mortgage", label: "Mortgage" },
];

/**
 * The price calculator page (Niko, 25 Nov 2026: "turn the price calculator into a button that opens a page that starts
 * with the residences and you can pick the one you want to use the calculator with, see if it makes sense to allow
 * someone to compare the payments price calculator with multiple units"). First the homes still for sale (pick one, or
 * up to four to compare), then how to pay (finish, in full, a plan paid monthly or quarterly, or a mortgage), then each
 * home's figures side by side. A link can pick homes: ?unit=203B or ?units=203B,108B.
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
  const [picked, setPicked] = useState<string[]>([]);
  const [kind, setKind] = useState<string>("all");
  const [tier, setTier] = useState(tiers[0]?.key ?? "standard");
  const [method, setMethod] = useState<PayMethod>("plan");
  const [months, setMonths] = useState<number>(12);
  const [every, setEvery] = useState<PlanEvery>("month");
  const resultsRef = useRef<HTMLElement>(null);
  const [resultsInView, setResultsInView] = useState(false);

  // Homes a link picked (?unit=203B from a home's pop-up, ?units=203B,108B from Residences' Compare).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const wanted = [q.get("unit") ?? "", ...(q.get("units") ?? "").split(",")]
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const found = homes.filter((h) => wanted.includes(h.unitNumber.toLowerCase())).map((h) => h.unitNumber).slice(0, MAX_HOMES);
    if (found.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the address bar can only be read in the browser
    setPicked(found);
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "instant", block: "start" }));
  }, [homes]);

  // The "See payments" bar shows on a phone while the figures are out of sight.
  useEffect(() => {
    const el = resultsRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setResultsInView(entry.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const kinds = useMemo(() => {
    const out: Array<{ kind: string; count: number; from: number }> = [];
    for (const h of homes) {
      const price = h.prices[tiers[0]?.key] ?? 0;
      const k = out.find((x) => x.kind === h.kind);
      if (k) {
        k.count += 1;
        k.from = Math.min(k.from, price);
      } else out.push({ kind: h.kind, count: 1, from: price });
    }
    return out;
  }, [homes, tiers]);

  const shown = homes.filter((h) => kind === "all" || h.kind === kind);
  const chosen = picked.map((n) => homes.find((h) => h.unitNumber === n)).filter((h): h is CalcHome => Boolean(h));
  const full = picked.length >= MAX_HOMES;

  function toggle(unit: string) {
    setPicked((list) => (list.includes(unit) ? list.filter((u) => u !== unit) : list.length >= MAX_HOMES ? list : [...list, unit]));
  }

  const tierRank = (key: string | null) => (key === null ? -1 : tiers.findIndex((t) => t.key === key));
  const vat = vatOn ? " incl. VAT" : "";
  const howWords =
    method === "full"
      ? "paying in full"
      : method === "plan"
        ? `on a ${months}-month payment plan with ${every === "month" ? "monthly" : "quarterly"} payments`
        : "with a mortgage";

  return (
    <div className={styles.page}>
      {/* 1. The homes */}
      <section className={styles.step} aria-labelledby="calc-homes">
        <div className={styles.stepHead}>
          <h2 id="calc-homes" className={styles.stepTitle}>
            <span className={styles.stepNo}>1</span> Pick a home, or up to {MAX_HOMES} to compare
          </h2>
          <span className={styles.count} aria-live="polite">
            {picked.length === 0 ? "None picked yet" : `${picked.length} of ${MAX_HOMES} picked`}
          </span>
        </div>
        <div className={styles.kinds} role="group" aria-label="Kind of home">
          <button type="button" className={styles.kind} aria-pressed={kind === "all"} onClick={() => setKind("all")}>
            All homes <small>{homes.length}</small>
          </button>
          {kinds.map((k) => (
            <button key={k.kind} type="button" className={styles.kind} aria-pressed={kind === k.kind} onClick={() => setKind(k.kind)}>
              {k.kind} <small>from {formatUSD(k.from)}</small>
            </button>
          ))}
        </div>
        <ul className={styles.homes}>
          {shown.map((h) => {
            const on = picked.includes(h.unitNumber);
            return (
              <li key={h.unitNumber}>
                <button
                  type="button"
                  className={styles.home}
                  aria-pressed={on}
                  disabled={!on && full}
                  onClick={() => toggle(h.unitNumber)}
                  title={!on && full ? `Up to ${MAX_HOMES} at a time: take one off first` : undefined}
                >
                  <span className={styles.homeTop}>
                    <span className={styles.homeUnit}>{h.unitNumber}</span>
                    <span className={styles.tick} aria-hidden="true">
                      {on ? "✓" : "+"}
                    </span>
                  </span>
                  <span className={styles.homeMeta}>
                    {h.type} · {h.floor} · {h.areaSqm} sqm
                  </span>
                  <span className={styles.homePrice}>
                    {formatUSD(h.prices[tiers[0]?.key] ?? 0)}
                    {vat && <small>{vat}</small>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {full && <p className={styles.hint}>Up to {MAX_HOMES} at a time: take one off to pick another.</p>}
      </section>

      {/* 2. How to pay */}
      <section className={styles.step} aria-labelledby="calc-how">
        <h2 id="calc-how" className={styles.stepTitle}>
          <span className={styles.stepNo}>2</span> How you would pay
        </h2>
        <div className={styles.settings}>
          <fieldset className={styles.group}>
            <legend>Finish</legend>
            <div className={styles.choices}>
              {tiers.map((t) => (
                <button key={t.key} type="button" className={styles.choice} aria-pressed={tier === t.key} onClick={() => setTier(t.key)}>
                  {t.name}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className={styles.group}>
            <legend>Paying</legend>
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
      </section>

      {/* 3. The figures, side by side */}
      <section ref={resultsRef} id="payments" className={styles.step} aria-labelledby="calc-results">
        <h2 id="calc-results" className={styles.stepTitle}>
          <span className={styles.stepNo}>3</span> Your payments
        </h2>
        {chosen.length === 0 ? (
          <p className={styles.empty}>Pick a home above to see its payments.</p>
        ) : (
          <div className={styles.results} data-count={chosen.length}>
            {chosen.map((home) => {
              const ownTier = tierRank(home.minTier) > tierRank(tier) && home.minTier ? home.minTier : tier;
              const tierName = tiers.find((t) => t.key === ownTier)?.name ?? "";
              const r = payFor({ listPrice: home.prices[ownTier] ?? home.prices[tier] ?? 0, method, offer, mortgagePct, deposit, months, every });
              const [feeLow, feeHigh] = monthlyFee(home.areaSqm);
              const changeLabel =
                method === "mortgage"
                  ? `Mortgage (+${r.changePct}%)`
                  : r.changePct < 0
                    ? `${method === "full" ? "Full payment" : "Plan"} discount (${-r.changePct}%${offer?.until ? `, to ${offer.until}` : ""})`
                    : "";
              return (
                <article key={home.unitNumber} className={styles.result}>
                  <div className={styles.resultHead}>
                    <div>
                      <div className={styles.unit}>{home.unitNumber}</div>
                      <div className={styles.meta}>
                        {home.type} · {home.floor} · {home.size}
                      </div>
                    </div>
                    <button type="button" className={styles.remove} onClick={() => toggle(home.unitNumber)} aria-label={`Take ${home.unitNumber} off`}>
                      ×
                    </button>
                  </div>
                  {ownTier !== tier && home.includedNote && <p className={styles.note}>{home.includedNote}</p>}

                  <dl className={styles.rows}>
                    <div>
                      <dt>List price ({tierName})</dt>
                      <dd>{formatUSD(r.listPrice)}</dd>
                    </div>
                    {changeLabel && (
                      <div className={r.changeAmount < 0 ? styles.saving : styles.extra}>
                        <dt>{changeLabel}</dt>
                        <dd>
                          {r.changeAmount < 0 ? "−" : "+"}
                          {formatUSD(Math.abs(r.changeAmount))}
                        </dd>
                      </div>
                    )}
                    <div className={styles.total}>
                      <dt>{method === "mortgage" ? "Price with a mortgage" : "Your price"}</dt>
                      <dd>{formatUSD(r.price)}</dd>
                    </div>
                  </dl>

                  <div className={styles.pay}>
                    <div className={styles.payRow}>
                      <span className={styles.when}>Today</span>
                      <span>
                        {formatUSD(r.deposit)} reservation{vatOn ? " (VAT included)" : ""}, the standard deposit
                      </span>
                    </div>
                    <div className={styles.payRow}>
                      <span className={styles.when}>Then</span>
                      {method === "plan" && r.payments ? (
                        <span>
                          <strong className={styles.big}>
                            {formatUSD(r.payments.amount)} a {r.payments.every === "month" ? "month" : "quarter"}
                          </strong>
                          <span className={styles.sub}>
                            {r.payments.count} payments over {months} months
                            {r.payments.last !== r.payments.amount ? `, the last ${formatUSD(r.payments.last)}` : ""}
                          </span>
                        </span>
                      ) : method === "mortgage" ? (
                        <span>
                          <strong className={styles.big}>{formatUSD(r.balance)}</strong>
                          <span className={styles.sub}>through your mortgage; your bank sets the monthly repayments</span>
                        </span>
                      ) : (
                        <span>
                          <strong className={styles.big}>{formatUSD(r.balance)}</strong>
                          <span className={styles.sub}>the balance</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className={styles.fee}>
                    <span className={styles.feeLabel}>Building fee, estimated</span>
                    <span className={styles.feeValue}>
                      {formatUSD(feeLow)}–{formatUSD(feeHigh)} a month
                    </span>
                  </div>

                  <div className={styles.actions}>
                    <a className={styles.reserve} href={`/reserve?unit=${encodeURIComponent(home.unitNumber)}`}>
                      Reserve {home.unitNumber}
                    </a>
                    <a
                      className={styles.whatsapp}
                      href={whatsappUrl(contactPhone, `Hi, I'm interested in ${home.unitNumber} at The Lexington (${home.type}, ${home.areaSqm} sqm), ${howWords}, ${tierName} finish. Can you tell me more?`)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Ask on WhatsApp
                    </a>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        <p className={styles.small}>
          Prices are in US dollars{vatOn ? " and include VAT" : ""}. {offer?.nextLine ? `${offer.nextLine} ` : ""}The building fee is an estimate of about US$
          {FEE_PER_SQM.low}–{FEE_PER_SQM.high} per sqm a month, set each year with the building&rsquo;s budget. A guide to the figures: your sale agreement sets
          the final amounts and dates. Amounts are rounded to the dollar.
        </p>
      </section>

      {/* On a phone: back to the figures after picking homes */}
      {chosen.length > 0 && !resultsInView && (
        <div className={styles.bar}>
          <span>
            {chosen.length === 1 ? chosen[0].unitNumber : `${chosen.length} homes`} picked
          </span>
          <button type="button" onClick={() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
            See payments
          </button>
        </div>
      )}
    </div>
  );
}
