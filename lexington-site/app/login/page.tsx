import { redirect } from "next/navigation";
import Link from "next/link";

import { getBuyerSession } from "@/lib/auth/session";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { buyerAccountByEmailQuery } from "@/lib/sanity/buyersQueries";
import type { BuyerAccount } from "@/lib/sanity/buyersTypes";
import { LoginForm } from "@/components/LoginForm";
import contactFormStyles from "@/components/ContactForm.module.css";
import styles from "./login.module.css";

export const metadata = {
  title: "Buyer Login | The Lexington",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getBuyerSession();
  if (session) {
    // Confirm the account behind this (still cryptographically valid)
    // session actually still exists -- e.g. it was deleted after the
    // cookie was issued -- before redirecting away. Skipping this check
    // would bounce a visitor with a stale cookie straight back to
    // /account, which bounces them right back here: an infinite loop
    // neither side can break, since a Server Component render (this
    // page) isn't allowed to clear the cookie itself.
    let buyer: BuyerAccount | null = null;
    try {
      buyer = await getBuyersClient().fetch<BuyerAccount | null>(buyerAccountByEmailQuery, {
        email: session.email,
      });
    } catch {
      // Buyers dataset unreachable -- fall through to the login form
      // rather than erroring the whole page.
    }
    if (buyer) {
      redirect(buyer.role === "admin" ? "/admin/crm" : "/account");
    }
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
