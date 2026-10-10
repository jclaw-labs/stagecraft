import type { Metadata } from "next";
import Button from "@/components/Button";
import { SITE_SECTIONS } from "../_components/site-sections";
import { SIGN_IN_HREF } from "../_components/site-links";
import styles from "./examples.module.css";

export const metadata: Metadata = {
  title: "What's included — Stagecraft",
  description:
    "What a Stagecraft site can start with: home, music, updates, about, and contact pages, a tour-date list, and themes to set the look.",
};

export default function ExamplesPage() {
  return (
    <main className={styles.main}>
      <header className={styles.head}>
        <h1 className={styles.title}>What your site comes with.</h1>
        <p className={styles.lead}>
          Every Stagecraft site can start from the same set of pages, or from
          a blank page. Pick a theme, swap in your own content, and it’s
          yours — code and all.
        </p>
        <div className={styles.ctas}>
          <Button href={SIGN_IN_HREF}>Start building</Button>
        </div>
      </header>

      <ul className={styles.grid}>
        {SITE_SECTIONS.map((section) => (
          <li key={section.name} className={styles.card}>
            <div className={styles.cardBody}>
              <h2 className={styles.cardTitle}>{section.name}</h2>
              <p className={styles.cardText}>{section.body}</p>
            </div>
          </li>
        ))}
      </ul>

      <p className={styles.note}>
        Live, clickable demos are on the way. For now, start a site to try it
        hands-on.
      </p>
    </main>
  );
}
