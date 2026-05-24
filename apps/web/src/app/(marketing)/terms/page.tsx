import type { Metadata } from "next";
import styles from "../_components/legal.module.css";

export const metadata: Metadata = {
  title: "Terms of Service — Stagecraft",
  description: "The terms that govern your use of Stagecraft.",
};

export default function TermsPage() {
  return (
    <main className={styles.main}>
      <p className={styles.notice}>
        These are placeholder terms of service. The final version will be
        published before launch.
      </p>
      <h1 className={styles.title}>Terms of Service</h1>
      <p className={styles.updated}>Last updated: May 2026</p>

      <section className={styles.section}>
        <h2 className={styles.heading}>Using Stagecraft</h2>
        <p className={styles.body}>
          Stagecraft is a tool for building and maintaining websites you own. By
          using the service you agree to use it lawfully and to respect the
          rights of others.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Your content and code</h2>
        <p className={styles.body}>
          You own the content you add and the code generated for your site, which
          lives in your own GitHub account. You are responsible for what you
          publish.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>The software</h2>
        <p className={styles.body}>
          Stagecraft is open source. The generated site templates use standard,
          industry-standard technology so you are never locked in.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Availability and changes</h2>
        <p className={styles.body}>
          The service is provided as-is while in active development. Features may
          change, and we’ll update these terms as the product matures.
        </p>
      </section>
    </main>
  );
}
