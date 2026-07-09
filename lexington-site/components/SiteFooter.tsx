import Link from "next/link";

import styles from "./SiteFooter.module.css";

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className="wrap">
        <div className={styles.top}>
          <div>
            <div className={styles.brand}>
              The Lexington
              <small>A Skarlatos &amp; Son Development</small>
            </div>
          </div>
          <div className={styles.links}>
            <div>
              <h4>Explore</h4>
              <Link href="/residences">Residences</Link>
              <Link href="/amenities">Amenities</Link>
              <Link href="/gallery">Gallery</Link>
              <Link href="/invest">Invest</Link>
            </div>
            <div>
              <h4>Contact</h4>
              <a href="tel:+233244305262">+233 (0)244 30 5262</a>
              <a href="mailto:sales@lexington.com.gh">sales@lexington.com.gh</a>
              <Link href="/contact">Reserve a Unit</Link>
            </div>
          </div>
        </div>
        <div className={styles.bottom}>
          <span>© {new Date().getFullYear()} Skarlatos &amp; Son. All rights reserved.</span>
          <span>Duala Close — Opposite Orchid Hotel, Shiashie, East Legon</span>
        </div>
      </div>
    </footer>
  );
}
