import { redirect } from "next/navigation";

import { getAdminSession } from "@/lib/auth/session";
import { AdminLoginForm } from "@/components/AdminLoginForm";
import styles from "../../login/login.module.css";

export const metadata = {
  title: "Admin | The Lexington",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  if (await getAdminSession()) {
    redirect("/admin");
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>The Lexington</div>
        <h1 className={styles.title}>Admin</h1>
        <p className={styles.lede}>Manage buyer accounts and login credentials.</p>
        <AdminLoginForm />
      </div>
    </main>
  );
}
