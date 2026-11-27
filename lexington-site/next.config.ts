import type { NextConfig } from "next";

// Which version of the site app this is, on every app page and API answer (27 Nov 2026): the phone's copy of the app
// (public/todo-sw.js) fetches its pages again when the website says a newer one is out. A development server says
// "dev", and then the phone keeps no copy at all.
const APP_BUILD =
  process.env.VERCEL_DEPLOYMENT_ID ||
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
  (process.env.NODE_ENV === "production" ? `local-${Date.now().toString(36)}` : "dev");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.sanity.io",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // frame-ancestors/object-src/base-uri only -- no default-src or
          // script-src, since Google Tag Manager injects GA4/Ads/Meta Pixel
          // tags dynamically from its own dashboard with no code change
          // here, and a locked-down script-src would silently break
          // whatever gets added there next.
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self';",
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      {
        // The site app's "Take photo" (a to-do job, a receipt) opens the phone's camera straight
        // away (Android ignores that request while the camera is switched off). Later entries
        // win for the same header, so this overrides the line above for the app's pages only.
        source: "/todo",
        headers: [
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
          { key: "X-App-Build", value: APP_BUILD },
        ],
      },
      {
        source: "/todo/:path*",
        headers: [
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
          { key: "X-App-Build", value: APP_BUILD },
        ],
      },
      {
        // The site app's own answers carry its version too (see APP_BUILD above).
        source: "/api/:path*",
        headers: [{ key: "X-App-Build", value: APP_BUILD }],
      },
      {
        // A buyer's own 3D page (public/3d/p/*.html, 18 Nov 2026: Armstrong's 5th-floor lock-off homes) shows inside
        // their portal's frame (app/account/page.tsx, the account's `home3dPage`): this site may frame it, nobody else,
        // and search engines leave it alone. Later entries win.
        source: "/3d/p/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self';" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        // The site roll call's own page (public/todo/rollcall.html: just the app, no records; it asks
        // /api/rollcall for those, signed in) shows inside the app's frame at /todo/rollcall (2 Nov 2026,
        // components/todo/RollcallPart.tsx): this site may frame it, nobody else. Later entries win.
        source: "/todo/rollcall.html",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self';" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;
