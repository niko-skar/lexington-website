import Link from "next/link";

import { pageMetadata } from "@/lib/seo";
import { client } from "@/lib/sanity/client";
import { siteSettingsQuery } from "@/lib/sanity/queries";
import type { SiteSettings } from "@/lib/sanity/types";

import { PageIntro } from "@/components/PageIntro";

export const revalidate = 600;

export const metadata = pageMetadata({
  path: "/terms",
  title: "Terms of Use | The Lexington",
  description:
    "The terms for using The Lexington's website, buyer accounts and our own office tools, including the licence terms for our private QuickBooks connection, Lexington Books.",
});

const UPDATED = "27 October 2026";

// Niko, 27 Oct 2026: Intuit asks every app that connects to QuickBooks for a public licence-terms
// page; this one covers the website as a whole and the "Lexington Books" app.
export default async function TermsPage() {
  const siteSettings = await client.fetch<SiteSettings>(siteSettingsQuery);

  return (
    <>
      <PageIntro eyebrow="Terms" title="Terms of Use" lede={`Last updated ${UPDATED}.`} />

      <section className="section" style={{ paddingTop: "clamp(32px, 4vw, 56px)" }}>
        <div className="wrap" style={{ maxWidth: 760, lineHeight: 1.7 }}>
          <p>
            These terms apply when you use this website, a buyer account on it, or any of the online tools The Lexington
            (&ldquo;we&rdquo;, &ldquo;us&rdquo;) runs for its own office. By using them you agree to these terms. How we
            handle personal information is explained in our <Link href="/privacy">Privacy Policy</Link>.
          </p>

          <h2 style={{ marginTop: 40 }}>Information on this website</h2>
          <p>
            Descriptions, pictures, floor plans, 3D models, prices, payment plans and availability are given for
            information and may change at any time. They are not an offer or a contract. A purchase is governed only by the
            sale agreement you sign with us.
          </p>

          <h2 style={{ marginTop: 40 }}>Using the website</h2>
          <ul>
            <li>Use the website lawfully and only for its intended purpose.</li>
            <li>Do not try to get into parts of it you have not been given access to, or interfere with how it works.</li>
            <li>
              The text, pictures and designs on it belong to us or the people who licensed them to us. You may view and share
              them for your own, non-commercial purposes, but not copy or publish them otherwise without our permission.
            </li>
          </ul>

          <h2 style={{ marginTop: 40 }}>Buyer accounts</h2>
          <p>
            A buyer account is for the buyer it was opened for. Keep your password to yourself and tell us straight away if
            you think someone else has used your account.
          </p>

          <h2 style={{ marginTop: 40 }}>Lexington Books (our QuickBooks connection)</h2>
          <p>
            Lexington Books is a private app that connects this website to The Lexington&rsquo;s own QuickBooks Online
            company, so that expenses and other entries recorded in our office tools reach our accounts without being typed
            twice. These are its licence terms:
          </p>
          <ul>
            <li>
              It is licensed only to The Lexington and the people we authorise, for The Lexington&rsquo;s own books. The licence
              cannot be transferred, and the app is not offered to anyone else.
            </li>
            <li>
              It reads accounting data and adds or updates entries in our QuickBooks company. It does not delete data, and it
              connects to no QuickBooks company other than ours.
            </li>
            <li>
              The accounting data it handles stays within The Lexington&rsquo;s own systems and the services that run them. We
              do not sell it or show it to anyone outside the company, except our accountants, auditors and the authorities
              where the law requires.
            </li>
            <li>
              It can be disconnected at any time, on its page in our admin area or from the apps list in QuickBooks.
              Disconnecting stops all access straight away.
            </li>
            <li>
              QuickBooks and Intuit are trademarks of Intuit Inc. Lexington Books is our own app; it is not made or endorsed by
              Intuit.
            </li>
          </ul>

          <h2 style={{ marginTop: 40 }}>Links to other websites</h2>
          <p>
            Links to other websites (for example maps, social media or payment services) are for convenience. We are not
            responsible for their content or how they handle your information.
          </p>

          <h2 style={{ marginTop: 40 }}>Our responsibility</h2>
          <p>
            We take care to keep this website and our tools accurate and working, but they are provided &ldquo;as is&rdquo;. As
            far as the law allows, we are not responsible for loss caused by relying on information on the website or by the
            website or a tool being unavailable. Nothing in these terms limits any responsibility that the law of Ghana does
            not allow to be limited.
          </p>

          <h2 style={{ marginTop: 40 }}>The law that applies</h2>
          <p>These terms are governed by the laws of Ghana, and the courts of Ghana deal with any dispute about them.</p>

          <h2 style={{ marginTop: 40 }}>Contact us</h2>
          <p>
            With any question about these terms, contact us at{" "}
            <a href={`mailto:${siteSettings.contactEmail}`}>{siteSettings.contactEmail}</a> or {siteSettings.contactPhone}.
            Our office is at {siteSettings.officeAddress}.
          </p>

          <p style={{ marginTop: 40 }}>
            We may update these terms from time to time. The date above shows when they last changed.
          </p>
        </div>
      </section>
    </>
  );
}
