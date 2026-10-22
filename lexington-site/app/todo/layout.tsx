import type { Metadata, Viewport } from "next";

// The site to-do list is its own home-screen app on Niko's iPhone and the foreman's Android:
// its own name, icon and colours, opening full screen at /todo.
export const metadata: Metadata = {
  title: "Site to-do | The Lexington",
  robots: { index: false, follow: false },
  manifest: "/todo.webmanifest",
  appleWebApp: { capable: true, title: "Site to-do", statusBarStyle: "black" },
  icons: {
    icon: [{ url: "/todo/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/todo/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#15181a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Signed-in, always-fresh data -- never prerendered.
export const dynamic = "force-dynamic";

export default function TodoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
