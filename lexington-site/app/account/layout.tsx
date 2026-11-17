import { logoutAction } from "@/lib/actions/logout";
import { stopPortalViewAction } from "@/lib/actions/portalView";
import { portalAccount } from "@/lib/auth/currentBuyer";
import { seesOnlyPlans } from "@/lib/planOptions";
import styles from "@/components/Portal.module.css";
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
// `viewing`: an admin is looking at this buyer's portal as the buyer sees it (lib/auth/portalView.ts). A band above the
// header says so, and the header's Sign Out ends the look instead of signing the admin out.
async function frame(): Promise<{ onlyPlans: boolean; viewing: string | null }> {
  try {
    const { buyer, viewing } = await portalAccount();
    return { onlyPlans: !!buyer && seesOnlyPlans(buyer), viewing: viewing && buyer ? buyer.name : null };
  } catch {
    return { onlyPlans: false, viewing: null }; // the page reports the failure
  }
}

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const { onlyPlans, viewing } = await frame();
  const navLinks = onlyPlans ? [] : NAV_LINKS;
  return (
    <>
      {viewing && (
        <form action={stopPortalViewAction} className={styles.viewBand}>
          <p>
            <b>Admin view.</b> This is {viewing}&rsquo;s portal as they see it. You are not signed in as them: buttons that save or send do nothing
            here.
          </p>
          <button type="submit">Back to Admin</button>
        </form>
      )}
      <PortalHeader navLinks={navLinks} signOutAction={viewing ? stopPortalViewAction : logoutAction} />
      {children}
    </>
  );
}
