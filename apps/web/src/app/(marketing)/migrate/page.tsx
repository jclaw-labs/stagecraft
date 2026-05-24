import type { Metadata } from "next";
import Button from "@/components/Button";
import { SIGN_IN_HREF } from "../_components/site-links";
import WaitlistForm from "./WaitlistForm";
import styles from "./migrate.module.css";

export const metadata: Metadata = {
  title: "Migrate your site — Stagecraft",
  description:
    "AI-powered migration from Squarespace and Wix is coming soon. Bring your existing site to Stagecraft and cancel the subscription.",
};

const SOURCES = ["Squarespace", "Wix", "Bandzoogle", "WordPress", "Webflow"];

export default function MigratePage() {
  return (
    <main className={styles.main}>
      <section className={styles.hero}>
        <span className={styles.badge}>Coming soon</span>
        <h1 className={styles.title}>Bring your site over. Cancel the subscription.</h1>
        <p className={styles.lead}>
          We’re building an AI migration tool that rebuilds your existing site in
          Stagecraft — your pages, your content, your images — as code you own. No
          more monthly bill, and no starting from scratch.
        </p>
        <div className={styles.sources}>
          {SOURCES.map((source) => (
            <span key={source} className={styles.source}>
              {source}
            </span>
          ))}
        </div>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Get notified when it’s ready</h2>
        <p className={styles.panelLead}>
          Leave your email and we’ll tell you the moment AI migration launches.
        </p>
        <WaitlistForm />
      </section>

      <section className={styles.alt}>
        <h2 className={styles.altTitle}>Don’t want to wait?</h2>
        <p className={styles.altLead}>
          Start a brand-new Stagecraft site today — free, and yours to keep.
        </p>
        <Button href={SIGN_IN_HREF}>Start building</Button>
      </section>
    </main>
  );
}
