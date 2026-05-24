import Link from "next/link";
import { GITHUB_URL, LEGAL_NAV, PRIMARY_NAV, SIGN_IN_HREF } from "./site-links";
import styles from "./MarketingFooter.module.css";

export default function MarketingFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.brandCol}>
          <span className={styles.brand}>Stagecraft</span>
          <p className={styles.tagline}>
            The open-source website builder for musicians. Own your code, deploy
            free, no subscription.
          </p>
        </div>
        <nav className={styles.col} aria-label="Product">
          <span className={styles.colTitle}>Product</span>
          {PRIMARY_NAV.map((link) => (
            <Link key={link.href} href={link.href} className={styles.link}>
              {link.label}
            </Link>
          ))}
          <Link href={SIGN_IN_HREF} className={styles.link}>
            Sign in
          </Link>
        </nav>
        <nav className={styles.col} aria-label="Resources">
          <span className={styles.colTitle}>Resources</span>
          <a
            href={GITHUB_URL}
            className={styles.link}
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
          {LEGAL_NAV.map((link) => (
            <Link key={link.href} href={link.href} className={styles.link}>
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className={styles.bottom}>
        <span>© {year} Stagecraft</span>
        <span>Built on open source. Yours to keep.</span>
      </div>
    </footer>
  );
}
