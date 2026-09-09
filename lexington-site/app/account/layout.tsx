import { logoutAction } from "@/lib/actions/logout";
import { PortalHeader } from "@/components/PortalHeader";

export const metadata = {
  robots: { index: false, follow: false },
};

// Auth-gated, always-fresh data (session cookie, live payments/documents) --
// never statically prerendered. Cascades to every /account/* page.
export const dynamic = "force-dynamic";

const NAV_LINKS = [
  { href: "/account", label: "Overview" },
  { href: "/account/payments", label: "Payments" },
  { href: "/account/documents", label: "Documents" },
];

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PortalHeader homeHref="/account" navLinks={NAV_LINKS} signOutAction={logoutAction} />
      {children}
    </>
  );
}
