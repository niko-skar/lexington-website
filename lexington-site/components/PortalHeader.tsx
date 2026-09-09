import Link from "next/link";

import styles from "./PortalHeader.module.css";

interface PortalHeaderProps {
  navLinks?: { href: string; label: string }[];
  signOutAction?: () => Promise<void>;
}

export function PortalHeader({ navLinks, signOutAction }: PortalHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.bar}>
        {/* Always the real site homepage, not a portal-specific "home" --
            a logo going anywhere else reads as broken. The portal's own
            nav links (Overview, etc.) cover in-portal navigation. */}
        <Link href="/" className={styles.brand}>
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
