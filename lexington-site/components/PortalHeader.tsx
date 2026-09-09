import Link from "next/link";

import styles from "./PortalHeader.module.css";

interface PortalHeaderProps {
  homeHref: string;
  navLinks?: { href: string; label: string }[];
  signOutAction?: () => Promise<void>;
}

export function PortalHeader({ homeHref, navLinks, signOutAction }: PortalHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.bar}>
        <Link href={homeHref} className={styles.brand}>
          The Lexington
          <small>Skarlatos &amp; Son</small>
        </Link>

        {navLinks && navLinks.length > 0 && (
          <nav className={styles.nav}>
            {navLinks.map((link) => (
              <Link key={link.href} href={link.href}>
                {link.label}
              </Link>
            ))}
          </nav>
        )}

        {signOutAction && (
          <form action={signOutAction}>
            <button type="submit" className={styles.signOut}>
              Sign Out
            </button>
          </form>
        )}
      </div>
    </header>
  );
}
