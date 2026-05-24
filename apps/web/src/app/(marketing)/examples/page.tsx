import type { Metadata } from "next";
import Button from "@/components/Button";
import { BLUEPRINTS } from "../_components/blueprints";
import { SIGN_IN_HREF } from "../_components/site-links";
import styles from "./examples.module.css";

export const metadata: Metadata = {
  title: "Examples — Stagecraft",
  description:
    "Templates built for every kind of musician — solo artists, bands, composers, press kits, and touring acts. Start from one and make it your own.",
};

export default function ExamplesPage() {
  return (
    <main className={styles.main}>
      <header className={styles.head}>
        <h1 className={styles.title}>Templates for every kind of act.</h1>
        <p className={styles.lead}>
          Every Stagecraft site starts from a template designed around what your
          kind of artist actually needs. Pick one, customize it, and it’s yours —
          code and all.
        </p>
      </header>

      <ul className={styles.grid}>
        {BLUEPRINTS.map((bp) => (
          <li key={bp.name} className={styles.card}>
            <div className={styles.thumb} aria-hidden="true">
              <span className={styles.thumbLabel}>{bp.name}</span>
            </div>
            <div className={styles.cardBody}>
              <h2 className={styles.cardTitle}>{bp.name}</h2>
              <p className={styles.cardText}>{bp.body}</p>
              <Button href={SIGN_IN_HREF} variant="secondary" size="sm">
                Start with this
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <p className={styles.note}>
        Live, clickable demos are on the way. For now, start a site to explore any
        template hands-on.
      </p>
    </main>
  );
}
