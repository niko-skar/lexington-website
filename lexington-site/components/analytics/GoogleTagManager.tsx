import Script from "next/script";

const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID;

/**
 * Google Tag Manager container. GTM is the single hub that fires GA4, the Meta
 * Pixel, and the Google Ads conversion tag — so we only ever load this one
 * script and manage every downstream tag from the GTM web UI, no redeploys.
 *
 * Gated on NEXT_PUBLIC_GTM_ID: with the env var unset (e.g. before the account
 * exists) this renders nothing, so it is safe to ship ahead of setup.
 *
 * Public pages only: mounted by app/(site)/layout.tsx, never the root layout,
 * so the site to-do, admin, buyer portal, logins and Studios never load it.
 * Once loaded, though, GTM keeps running through client-side navigations, and
 * GA4 and the Meta Pixel count each one as a page view by default. So every
 * link between the public site and a private page (the header's Buyer Portal,
 * the login and portal logos, the login page's help link) is a plain <a>,
 * never <Link>: a full page load, so the container never follows a visitor
 * into a private page, not even on Back.
 */
export function GoogleTagManager() {
  if (!GTM_ID) return null;

  return (
    <Script id="gtm-base" strategy="afterInteractive">
      {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${GTM_ID}');`}
    </Script>
  );
}

/** The <noscript> fallback iframe. Belongs immediately inside <body>. */
export function GoogleTagManagerNoScript() {
  if (!GTM_ID) return null;

  return (
    <noscript>
      <iframe
        src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
        height="0"
        width="0"
        style={{ display: "none", visibility: "hidden" }}
        title="gtm"
      />
    </noscript>
  );
}
