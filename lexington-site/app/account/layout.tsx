import { logoutAction } from "@/lib/actions/logout";
import { loadBuyerAccount } from "@/lib/auth/currentBuyer";
import { getBuyerSession } from "@/lib/auth/session";
import { seesOnlyPlans } from "@/lib/planOptions";
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

// An account kept to its plans has no other page to go to, so its header carries no links. (The pages
// themselves turn such a buyer back as well: requireCurrentBuyer.) The account is the same one the page
// loads -- asked for once.
async function onlyPlans(): Promise<boolean> {
  try {
    const session = await getBuyerSession();
    if (!session) return false;
    const buyer = await loadBuyerAccount(session.email);
    return !!buyer && seesOnlyPlans(buyer);
  } catch {
    return false; // the page reports the failure
  }
}

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const navLinks = (await onlyPlans()) ? [] : NAV_LINKS;
  return (
    <>
      <PortalHeader navLinks={navLinks} signOutAction={logoutAction} />
      {children}
    </>
  );
}
