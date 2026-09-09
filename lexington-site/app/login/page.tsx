import { redirect } from "next/navigation";
import Link from "next/link";

import { getBuyerSession } from "@/lib/auth/session";
import { LoginForm } from "@/components/LoginForm";
import contactFormStyles from "@/components/ContactForm.module.css";
import styles from "./login.module.css";

export const metadata = {
  title: "Buyer Login | The Lexington",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getBuyerSession()) {
    redirect("/account");
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <Link href="/" className={styles.brand}>
          The Lexington
        </Link>
        <h1 className={styles.title}>Buyer Sign In</h1>
        <p className={styles.lede}>
          Track your deposits, unit and documents. Accounts are set up by
          our sales team — contact us if you don&rsquo;t have login details.
        </p>
        <LoginForm />
        <p className={contactFormStyles.note}>
          <Link href="/contact">Need help signing in?</Link>
        </p>
      </div>
    </main>
  );
}
