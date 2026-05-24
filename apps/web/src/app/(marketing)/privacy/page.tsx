import type { Metadata } from "next";
import styles from "../_components/legal.module.css";

export const metadata: Metadata = {
  title: "Privacy Policy — Stagecraft",
  description: "How Stagecraft handles your data.",
};

export default function PrivacyPage() {
  return (
    <main className={styles.main}>
      <p className={styles.notice}>
        This is a placeholder privacy policy. The final version will be published
        before launch.
      </p>
      <h1 className={styles.title}>Privacy Policy</h1>
      <p className={styles.updated}>Last updated: May 2026</p>

      <section className={styles.section}>
        <h2 className={styles.heading}>Overview</h2>
        <p className={styles.body}>
          Stagecraft helps you build and own a website. We aim to collect as
          little personal data as possible. Your website’s code and content live
          in your own GitHub account — not locked inside our platform.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>What we collect</h2>
        <p className={styles.body}>
          When you sign in with GitHub, we receive your basic account details and
          the permissions you grant so we can create and update repositories on
          your behalf. We store only what we need to operate the service.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>How we use it</h2>
        <p className={styles.body}>
          We use your information to authenticate you, create and manage your
          sites, and communicate with you about the service. We do not sell your
          personal data.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Your data and ownership</h2>
        <p className={styles.body}>
          Your site lives in your own GitHub account. You can disconnect from
          Stagecraft at any time and keep the full codebase.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Contact</h2>
        <p className={styles.body}>
          Questions about this policy can be directed to the Stagecraft team. A
          contact address will be added here before launch.
        </p>
      </section>
    </main>
  );
}
