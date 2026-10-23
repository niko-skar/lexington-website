import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed, IBM_Plex_Mono } from "next/font/google";

// The site app (to-do, store room, expenses) is its own home-screen app on Niko's iPhone and the
// foreman's Android: its own name, icon and colours, opening full screen at /todo. It wears the
// look of the old Site Expense Log page (Niko, 23 Oct 2026: "i like it more"): Barlow Condensed
// headings, Barlow text, IBM Plex Mono figures.
const display = Barlow_Condensed({ subsets: ["latin"], weight: ["600", "700"], variable: "--x-font-display" });
const body = Barlow({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--x-font-body" });
const numbers = IBM_Plex_Mono({ subsets: ["latin"], weight: ["500"], variable: "--x-font-num" });

export const metadata: Metadata = {
  title: "Site to-do | The Lexington",
  robots: { index: false, follow: false },
  manifest: "/todo.webmanifest",
  appleWebApp: { capable: true, title: "Site to-do", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/todo/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/todo/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eceeec" },
    { media: "(prefers-color-scheme: dark)", color: "#111617" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Signed-in, always-fresh data -- never prerendered.
export const dynamic = "force-dynamic";

export default function TodoLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${display.variable} ${body.variable} ${numbers.variable}`}>{children}</div>;
}
