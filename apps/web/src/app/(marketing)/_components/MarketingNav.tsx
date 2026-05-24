import Link from "next/link";
import Button from "@/components/Button";
import { GITHUB_URL, PRIMARY_NAV, SIGN_IN_HREF } from "./site-links";
import styles from "./MarketingNav.module.css";

export default function MarketingNav() {
  return (
    <header className={styles.header}>
      <nav className={styles.nav} aria-label="Primary">
        <Link href="/" className={styles.brand}>
          Stagecraft
        </Link>
        <div className={styles.links}>
          {PRIMARY_NAV.map((link) => (
            <Link key={link.href} href={link.href} className={styles.link}>
              {link.label}
            </Link>
          ))}
          <a
            href={GITHUB_URL}
            className={styles.link}
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
        </div>
        <div className={styles.actions}>
          <Button href={SIGN_IN_HREF} size="sm">
            Start building
          </Button>
        </div>
      </nav>
    </header>
  );
}
