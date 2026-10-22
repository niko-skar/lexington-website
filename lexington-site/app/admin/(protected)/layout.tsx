import { adminLogoutAction } from "@/lib/actions/adminAuth";
import { ToastProvider } from "@/components/crm/Toasts";
import { PortalHeader } from "@/components/PortalHeader";

export const metadata = {
  robots: { index: false, follow: false },
};

// Auth-gated, always-fresh data -- never statically prerendered.
export const dynamic = "force-dynamic";

const NAV_LINKS = [
  { href: "/admin/crm", label: "Prospects" },
  { href: "/admin", label: "Buyers" },
  { href: "/admin/dashboard", label: "Dashboard" },
  { href: "/admin/progress", label: "Site updates" },
  { href: "/admin/asbuilt", label: "As-built" },
  { href: "/todo", label: "Site to-do" },
];

export default function AdminProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PortalHeader navLinks={NAV_LINKS} signOutAction={adminLogoutAction} />
      <ToastProvider>{children}</ToastProvider>
    </>
  );
}
