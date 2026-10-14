import { pageMetadata } from "@/lib/seo";
import { client } from "@/lib/sanity/client";
import { siteSettingsQuery } from "@/lib/sanity/queries";
import type { SiteSettings } from "@/lib/sanity/types";

import { PageIntro } from "@/components/PageIntro";

export const revalidate = 600;

export const metadata = pageMetadata({
  path: "/privacy",
  title: "Privacy Policy | The Lexington",
  description:
    "How The Lexington collects, uses and protects the personal information you share through our website, enquiry forms, Facebook and Instagram lead forms and WhatsApp.",
});

const UPDATED = "14 October 2026";

export default async function PrivacyPage() {
  const siteSettings = await client.fetch<SiteSettings>(siteSettingsQuery);

  return (
    <>
      <PageIntro
        eyebrow="Privacy"
        title="Privacy Policy"
        lede={`Last updated ${UPDATED}.`}
      />

      <section className="section" style={{ paddingTop: "clamp(32px, 4vw, 56px)" }}>
        <div className="wrap" style={{ maxWidth: 760, lineHeight: 1.7 }}>
          <p>
            This policy explains what personal information The Lexington
            (&ldquo;we&rdquo;, &ldquo;us&rdquo;) collects when you use this
            website, send us an enquiry, complete a lead form on Facebook or
            Instagram, or message us on WhatsApp, and how we use it.
          </p>

          <h2 style={{ marginTop: 40 }}>What we collect</h2>
          <ul>
            <li>
              <strong>Details you give us:</strong> your name, WhatsApp or
              phone number, email address, the unit you are interested in, how
              you would like to pay, when you would like a viewing or video
              tour, how soon you hope to buy, and any message you write.
            </li>
            <li>
              <strong>If you start a reservation:</strong> the same details,
              plus the country you live in, how you prefer to be contacted,
              what the residence is for, whether you are buying alone, with
              someone else or through a company (and their names), whether
              you have visited, and which advert or link brought you to us.
              We email you the reservation form at the address you give. The
              reservation questions do not take a payment and do not ask for
              card or bank details.
            </li>
            <li>
              <strong>Usage information:</strong> pages visited, device and
              browser type, and approximate location, collected through
              cookies and similar tools such as Google Analytics and the Meta
              Pixel.
            </li>
            <li>
              <strong>Our own visit record:</strong> the website also keeps an
              anonymous record of each visit: the pages opened and in what
              order, how long each was open and how far down it was read, taps
              that seemed not to work, whether the enquiry form or a WhatsApp,
              phone or email link was used, the country (worked out from the
              connection), the type of device and browser, and where the visit
              came from (for example an advert). It uses no cookies, does not
              keep your IP address or anything you type, and cannot tell who
              you are or link one visit to another. Nothing is recorded if your
              browser sends a Do Not Track or Global Privacy Control signal.
            </li>
          </ul>

          <h2 style={{ marginTop: 40 }}>How we use it</h2>
          <ul>
            <li>To reply to your enquiry and send prices, floor plans and availability.</li>
            <li>To arrange viewings, video tours and reservations, and to email you the reservation form you ask for.</li>
            <li>To follow up on your enquiry by WhatsApp, phone or email.</li>
            <li>To understand how people use our website and improve our advertising.</li>
          </ul>
          <p>
            We do not sell your personal information.
          </p>

          <h2 style={{ marginTop: 40 }}>Who we share it with</h2>
          <p>
            Only with service providers who help us run these services: our
            website host, our email and customer-record tools, Meta
            (Facebook, Instagram and WhatsApp), and Google. They may only use
            your information to provide their service to us, or as set out in
            their own privacy policies.
          </p>

          <h2 style={{ marginTop: 40 }}>Cookies and advertising</h2>
          <p>
            We use cookies and the Meta Pixel to measure visits and show
            relevant adverts. You can block or delete cookies in your browser
            settings, and manage ad preferences in your Facebook, Instagram
            and Google accounts.
          </p>

          <h2 style={{ marginTop: 40 }}>How long we keep it</h2>
          <p>
            We keep your information for as long as we need it to deal with
            your enquiry or purchase, and for any period the law requires.
            After that we delete it or make it anonymous. The anonymous visit
            record is deleted after 30 days.
          </p>

          <h2 style={{ marginTop: 40 }}>Your rights</h2>
          <p>
            Under Ghana&rsquo;s Data Protection Act, 2012 (Act 843), you may
            ask to see the personal information we hold about you, ask us to
            correct it, or ask us to delete it. You can also ask us to stop
            contacting you at any time, including by replying &ldquo;stop&rdquo;
            on WhatsApp.
          </p>

          <h2 style={{ marginTop: 40 }}>Contact us</h2>
          <p>
            To exercise any of these rights, or with any question about this
            policy, contact us at{" "}
            <a href={`mailto:${siteSettings.contactEmail}`}>{siteSettings.contactEmail}</a>{" "}
            or {siteSettings.contactPhone}. Our office is at{" "}
            {siteSettings.officeAddress}.
          </p>

          <p style={{ marginTop: 40 }}>
            We may update this policy from time to time. The date above shows
            when it last changed.
          </p>
        </div>
      </section>
    </>
  );
}
