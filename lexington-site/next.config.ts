import type { NextConfig } from "next";

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
        headers: [{ key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" }],
      },
      {
        source: "/todo/:path*",
        headers: [{ key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" }],
      },
    ];
  },
};

export default nextConfig;
