import Link from "next/link";

import { Button } from "@/components/Button";
import { PageIntro } from "@/components/PageIntro";
import { PriceListForm } from "@/components/PriceListForm";
import { Reveal } from "@/components/Reveal";
import { offerSchedule } from "@/lib/agents/factsCore";
import { formatUSD, whatsappUrl } from "@/lib/format";
import { RESERVATION_FEE_USD } from "@/lib/reservation/config";
import { client } from "@/lib/sanity/client";
import { siteSettingsQuery } from "@/lib/sanity/queries";
import type { SiteSettings } from "@/lib/sanity/types";
import { ESTIMATED_COMPLETION, pageMetadata } from "@/lib/seo";
import { feeVatSuffix, vatFrom } from "@/lib/vat";

import styles from "./abroad.module.css";

export const revalidate = 600;

export const metadata = pageMetadata({
  path: "/buying-from-abroad",
  title: "Buying from Abroad | The Lexington",
  description:
    "How to choose and secure a home at The Lexington in Shiashie, East Legon, from wherever you live: a video tour on WhatsApp, live prices in US dollars, a $10,000 reservation and your own buyer portal.",
});

/**
 * For buyers who live abroad (Niko, 24 Nov 2026). Every step
 * is something the site and the team already do: the video tour on WhatsApp (/visit?kind=video), the live list on
 * Residences, the reservation form by email, the buyer portal, the payment plan, the progress photos, the rentals team.
 */
export default async function BuyingFromAbroadPage() {
  const settings = await client.fetch<SiteSettings>(siteSettingsQuery);
  const vat = vatFrom(settings);
  const schedule = offerSchedule(settings.promoBanner, new Date().toISOString().slice(0, 10));
  const planMonths = schedule.now?.planMonths ?? schedule.next?.planMonths ?? null;
  const fee = `${formatUSD(RESERVATION_FEE_USD)} reservation${feeVatSuffix(vat)}`;
  const whatsappHref = whatsappUrl(settings.contactPhone, "Hi, I live abroad and I'm interested in The Lexington.");

  const steps: Array<{ title: string; text: string; link?: { href: string; label: string } }> = [
    {
      title: "See it live",
      text: "Book a video tour: we video call you on WhatsApp and show you the building and the homes, Monday to Saturday, 8am to 6pm Accra time. Every home also has its own 3D floor plan.",
      link: { href: "/visit?kind=video", label: "Book a video tour" },
    },
    {
      title: "Choose your home",
      text: `Prices and availability on the Residences page are live, in US dollars${vat.on ? " with VAT included" : ""}. Ask us anything on WhatsApp.`,
      link: { href: "/residences", label: "See the homes" },
    },
    {
      title: "Reserve it",
      text: `Answer a few questions and we email you the reservation form. The ${fee} is the standard deposit and holds your home. Card and bank-transfer deposit options are available on request.`,
      link: { href: "/reserve", label: "Reserve a home" },
    },
    {
      title: "Pay from where you are",
      text: `Pay the rest in full, or on a payment plan${planMonths ? ` of up to ${planMonths} months` : ""}. We agree with you how you will pay, and send you the bank details ourselves.`,
      link: { href: "/invest", label: "Payment plans and discounts" },
    },
    {
      title: "Your own buyer portal",
      text: "Once you have reserved, your buyer portal keeps your details for the agreement, your documents and your payments in one place, with your home in 3D.",
    },
    {
      title: "Follow the build",
      text: `Real photos from the site, posted as the building goes up. Estimated completion: ${ESTIMATED_COMPLETION.monthName} ${ESTIMATED_COMPLETION.year}.`,
      link: { href: "/progress", label: "Construction progress" },
    },
    {
      title: "Let it, if you like",
      text: "When it is finished, our in-house rentals team can let and manage your home for you.",
      link: { href: "/invest", label: "Rental estimates" },
    },
  ];

  return (
    <>
      <PageIntro
        eyebrow="Buying from abroad"
        title="A home in East Legon, from wherever you live."
        lede="You don't have to be in Accra to choose and secure a home at The Lexington. Here is how it works, step by step."
      />

      <section className="section sectionStone" style={{ paddingTop: "clamp(32px, 4vw, 56px)" }}>
        <div className="wrap">
          <ol className={styles.steps}>
            {steps.map((step, i) => (
              <li key={step.title} className={styles.step}>
                <span className={styles.number} aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <h2 className={styles.title}>{step.title}</h2>
                  <p className={styles.text}>{step.text}</p>
                  {step.link && (
                    <Link className={styles.link} href={step.link.href}>
                      {step.link.label}
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section sectionStone" id="price-list" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <PriceListForm from="/buying-from-abroad" />
        </div>
      </section>

      <section className="section sectionStone" style={{ background: "var(--stone-lt)", textAlign: "center" }}>
        <div className="wrap">
          <Reveal>
            <div className="eyebrow" style={{ justifyContent: "center", display: "flex" }}>
              Next step
            </div>
            <h2 className={styles.ctaTitle}>See it live, from wherever you are.</h2>
            <p className={styles.ctaText}>A video tour on WhatsApp, Monday to Saturday, 8am to 6pm Accra time (GMT).</p>
            <div className={styles.ctaActions}>
              <Button href="/visit?kind=video" variant="clay">
                Book a Video Tour
              </Button>
              <a className={styles.whatsapp} href={whatsappHref} target="_blank" rel="noopener noreferrer">
                Message us on WhatsApp
              </a>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
