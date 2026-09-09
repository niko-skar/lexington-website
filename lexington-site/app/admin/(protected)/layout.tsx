import { adminLogoutAction } from "@/lib/actions/adminAuth";
import { PortalHeader } from "@/components/PortalHeader";

export const metadata = {
  robots: { index: false, follow: false },
};

// Auth-gated, always-fresh data -- never statically prerendered.
export const dynamic = "force-dynamic";

export default function AdminProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PortalHeader homeHref="/admin" signOutAction={adminLogoutAction} />
      {children}
    </>
  );
}
