import type { Metadata } from "next";
import Button from "@/components/Button";
import { BLUEPRINTS } from "./_components/blueprints";
import { GITHUB_URL, SIGN_IN_HREF } from "./_components/site-links";
import styles from "./home.module.css";

export const metadata: Metadata = {
  title: "Stagecraft — Own your website. Skip the subscription.",
  description:
    "An open-source website builder for musicians. Get a real codebase in your own GitHub, deploy it free, and edit it forever — no subscription, no lock-in.",
};

const STEPS = [
  {
    title: "Pick a template",
    body: "Start from a design built for your kind of act — solo artist, band, composer, or press kit.",
  },
  {
    title: "Make it yours",
    body: "Edit text, images, and pages in the visual editor. No code required to get a polished site.",
  },
  {
    title: "It lands in your GitHub",
    body: "Your site is a standard code project committed to a repository you own — not locked inside our platform.",
  },
  {
    title: "Deploy free, edit anytime",
    body: "Publish to a free host and keep editing — in Stagecraft, in code, or both.",
  },
];

const FEATURES = [
  {
    title: "Built-in contact form",
    body: "Visitors can reach you out of the box — no extra service to wire up.",
  },
  {
    title: "Responsive everywhere",
    body: "Looks right on phones, tablets, and desktops by default.",
  },
  {
    title: "Fast static pages",
    body: "Lightweight pages that load quickly and rank well.",
  },
  {
    title: "Accessible by default",
    body: "Semantic markup, alt text, and keyboard-friendly navigation.",
  },
  {
    title: "SEO-ready",
    body: "Clean markup and metadata so fans can actually find you.",
  },
  {
    title: "Image galleries",
    body: "Show off photos and press shots with optimized, responsive images.",
  },
];

const FAQS = [
  {
    q: "Is it really free?",
    a: "Yes. Building, editing, and exporting your site is free, and the generated site runs great on free hosting tiers. You only ever pay your own host if you choose a paid plan.",
  },
  {
    q: "Do I actually own the code?",
    a: "Completely. Your site lives as a normal code project in your own GitHub account. Clone it, keep it, hand it to a developer — it’s yours.",
  },
  {
    q: "What if I want to leave Stagecraft?",
    a: "Disconnect any time and keep the full codebase. Nothing stops working, because your site was never trapped inside our platform.",
  },
  {
    q: "Do I need to know how to code?",
    a: "No. Use the visual editor to build and update your site. The code is always there for the day you (or a developer) want it.",
  },
  {
    q: "Is there AI?",
    a: "Stagecraft doesn’t edit your site with AI today. But because your site is standard code, any AI coding assistant can. And AI-powered migration from other site builders is coming soon.",
  },
];

function Check() {
  return (
    <svg
      className={styles.check}
      viewBox="0 0 20 20"
      width="20"
      height="20"
      aria-hidden="true"
    >
      <path
        d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.8 7.8a1 1 0 0 1-1.4 0L3.3 9.9a1 1 0 1 1 1.4-1.4l3.5 3.5 7.1-7.1a1 1 0 0 1 1.4 0Z"
        fill="currentColor"
      />
    </svg>
  );
}

export default function HomePage() {
  return (
    <main>
      {/* Hero */}
      <section className={`${styles.section} ${styles.hero}`}>
        <div className={styles.container}>
          <p className={styles.eyebrow}>Open-source website builder for musicians</p>
          <h1 className={styles.heroTitle}>Own your website. Skip the subscription.</h1>
          <p className={styles.heroSub}>
            Stagecraft builds you a professional musician website as real, modern
            code that lives in your own GitHub — free to deploy, free to edit, and
            yours to keep even if you walk away.
          </p>
          <div className={styles.heroCtas}>
            <Button href={SIGN_IN_HREF}>Start building</Button>
            <Button href="/examples" variant="secondary">
              See examples
            </Button>
          </div>
          <a
            className={styles.sourceLink}
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            View the source on GitHub
          </a>
        </div>
      </section>

      {/* Villain */}
      <section className={`${styles.section} ${styles.alt}`}>
        <div className={`${styles.container} ${styles.narrow} ${styles.center}`}>
          <h2 className={styles.title}>
            You don’t own your Squarespace site. You’re renting it.
          </h2>
          <p className={styles.lead}>
            Site builders charge you every month, never hand over the code, and
            lock your site inside a format you can’t take with you. Stop paying and
            it all disappears. Your website should be an asset you own — not a
            subscription you’re afraid to cancel.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section className={styles.section}>
        <div className={styles.container}>
          <div className={styles.head}>
            <h2 className={styles.title}>A real website. Real code. Yours.</h2>
            <p className={styles.lead}>
              Stagecraft turns a template into a complete site in your own GitHub
              account — then gets out of your way.
            </p>
          </div>
          <ol className={styles.steps}>
            {STEPS.map((step, i) => (
              <li key={step.title} className={styles.step}>
                <span className={styles.stepNum}>{i + 1}</span>
                <h3 className={styles.cardTitle}>{step.title}</h3>
                <p className={styles.cardBody}>{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Leave anytime — centerpiece */}
      <section className={`${styles.section} ${styles.alt}`}>
        <div className={styles.container}>
          <div className={styles.spotlight}>
            <h2 className={styles.spotlightTitle}>
              No lock-in. Leave whenever you want — and take everything.
            </h2>
            <p className={styles.spotlightBody}>
              Keep Stagecraft as your editor for as long as it’s useful. The day
              you’d rather go solo, disconnect and walk away with the full
              codebase. Nothing breaks, because your site was never a walled
              garden — it’s just standard code that happens to be yours.
            </p>
          </div>
        </div>
      </section>

      {/* Standard tech */}
      <section className={styles.section}>
        <div className={`${styles.container} ${styles.narrow} ${styles.center}`}>
          <h2 className={styles.title}>Built on tech the whole world already knows.</h2>
          <p className={styles.lead}>
            Your site is Next.js, React, and TypeScript — the industry standard.
            Hire any web developer, or point an AI coding assistant like Claude or
            Cursor at it and describe what you want. It’s never trapped in a
            proprietary format that disappears if a company does.
          </p>
        </div>
      </section>

      {/* Batteries included */}
      <section className={`${styles.section} ${styles.alt}`}>
        <div className={styles.container}>
          <div className={styles.head}>
            <h2 className={styles.title}>Everything a musician site needs, out of the box.</h2>
          </div>
          <ul className={styles.features}>
            {FEATURES.map((feature) => (
              <li key={feature.title} className={styles.feature}>
                <Check />
                <div>
                  <h3 className={styles.cardTitle}>{feature.title}</h3>
                  <p className={styles.cardBody}>{feature.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Blueprints */}
      <section className={styles.section}>
        <div className={styles.container}>
          <div className={styles.head}>
            <h2 className={styles.title}>Start from a template made for your act.</h2>
            <p className={styles.lead}>
              Each blueprint comes with the pages and sections that kind of artist
              actually needs.
            </p>
          </div>
          <ul className={styles.blueprints}>
            {BLUEPRINTS.map((bp) => (
              <li key={bp.name} className={styles.blueprint}>
                <h3 className={styles.cardTitle}>{bp.name}</h3>
                <p className={styles.cardBody}>{bp.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Migration — coming soon */}
      <section className={`${styles.section} ${styles.alt}`}>
        <div className={`${styles.container} ${styles.narrow} ${styles.center}`}>
          <span className={styles.badge}>Coming soon</span>
          <h2 className={styles.title}>
            Already have a site? Bring it over — and cancel the subscription.
          </h2>
          <p className={styles.lead}>
            Our AI migration tool, currently in the works, will rebuild your
            existing Squarespace or Wix site in Stagecraft — so you can move off
            the monthly bill without starting from scratch.
          </p>
          <div className={styles.headCtas}>
            <Button href="/migrate" variant="secondary">
              Learn about migration
            </Button>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className={styles.section}>
        <div className={`${styles.container} ${styles.narrow}`}>
          <div className={styles.head}>
            <h2 className={styles.title}>Questions, answered.</h2>
          </div>
          <div className={styles.faq}>
            {FAQS.map((item) => (
              <details key={item.q} className={styles.faqItem}>
                <summary className={styles.faqQ}>{item.q}</summary>
                <p className={styles.faqA}>{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className={styles.section}>
        <div className={styles.container}>
          <div className={styles.finalCta}>
            <h2 className={styles.finalTitle}>Build a website you’ll actually own.</h2>
            <p className={styles.finalBody}>
              Free to start, free to run, and yours to keep. No subscription, no
              lock-in.
            </p>
            <div className={styles.headCtas}>
              <Button href={SIGN_IN_HREF}>Start building</Button>
              <Button
                href={GITHUB_URL}
                variant="secondary"
                target="_blank"
                rel="noopener noreferrer"
              >
                Star us on GitHub
              </Button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
