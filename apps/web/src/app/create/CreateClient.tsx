"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/Button";
import Input from "@/components/Input";
import { pickStepIndex } from "@/lib/progress-steps";

import styles from "./create.module.css";

type Mode = "choose" | "scratch" | "recreate" | "creating";

// Open-loop progress messages, shown while the POST is in flight. The work
// itself (createRepo → pushFiles → deploy provision → setEnvVars → finalize)
// runs in the job queue once POST /api/sites returns, and the site page
// tracks it. See lib/progress-steps.ts for why this is time-based.
const PROGRESS_STEPS = [
  "Creating GitHub repository…",
  "Pushing template files…",
  "Provisioning hosting project…",
  "Setting up environment variables…",
  "Almost done…",
] as const;

const PROGRESS_INTERVAL_MS = 2000;

export default function CreateClient() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("choose");
  const [siteName, setSiteName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [error, setError] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [progressIndex, setProgressIndex] = useState(0);

  useEffect(() => {
    if (mode !== "creating") {
      setProgressIndex(0);
      return;
    }
    const startedAt = Date.now();
    const tick = () => {
      setProgressIndex(
        pickStepIndex(Date.now() - startedAt, PROGRESS_INTERVAL_MS, PROGRESS_STEPS.length),
      );
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [mode]);

  async function handleCreateFromScratch() {
    setError("");
    setIsCreating(true);
    setMode("creating");

    try {
      const res = await fetch("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: siteName.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to create site");
        setMode("scratch");
        setIsCreating(false);
        return;
      }

      router.push(`/sites/${data.site.id}`);
    } catch {
      setError("Something went wrong. Please try again.");
      setMode("scratch");
      setIsCreating(false);
    }
  }

  async function handleRecreate() {
    setError("");

    try {
      new URL(sourceUrl.trim());
    } catch {
      setError("Please enter a valid URL starting with http:// or https://");
      return;
    }

    setIsCreating(true);
    setMode("creating");

    try {
      const res = await fetch("/api/migrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: sourceUrl.trim(),
          name: siteName.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to start site creation");
        setMode("recreate");
        setIsCreating(false);
        return;
      }

      router.push(`/sites/${data.site.id}`);
    } catch {
      setError("Something went wrong. Please try again.");
      setMode("recreate");
      setIsCreating(false);
    }
  }

  return (
    <div className={styles.container}>
      <a className={styles.breadcrumb} href="/dashboard">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        Sites
      </a>

      <div className={styles.pageHead}>
        <h1 className={styles.title}>Create a new site</h1>
      </div>

      {error && (
        <div className={`${styles.banner} ${styles.bannerError}`}>
          <p>{error}</p>
        </div>
      )}

      {mode === "choose" && (
        <section>
          <p className={styles.lead}>How would you like to get started?</p>
          <div className={styles.chooseGrid}>
            <Button variant="card" onClick={() => setMode("scratch")}>
              <strong>Start from scratch</strong>
              <br />
              <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-size-sm)" }}>
                Create a blank musician site with placeholder content you can customize.
              </span>
            </Button>
            <Button variant="card" onClick={() => setMode("recreate")}>
              <strong>Recreate from an existing site</strong>
              <br />
              <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-size-sm)" }}>
                Enter a URL and we&rsquo;ll extract the content and build a new site from it.
              </span>
            </Button>
          </div>
        </section>
      )}

      {mode === "scratch" && (
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Start from scratch</h2>
          <div className={styles.formRows}>
            <Input
              id="site-name"
              label="Artist / Site name"
              value={siteName}
              onChange={setSiteName}
              placeholder="e.g. Sarah Chen Music"
            />
          </div>
          <div className={styles.actions}>
            <Button onClick={handleCreateFromScratch} isDisabled={!siteName.trim() || isCreating}>
              Create site
            </Button>
            <Button variant="ghost" onClick={() => { setMode("choose"); setError(""); }}>
              &larr; Back
            </Button>
          </div>
        </section>
      )}

      {mode === "recreate" && (
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Recreate from an existing site</h2>
          <p className={styles.panelLead}>
            We&rsquo;ll crawl the site, extract the content, and build a new Stagecraft site from it.
          </p>
          <div className={styles.formRows}>
            <Input
              id="source-url"
              label="Existing website URL"
              value={sourceUrl}
              onChange={setSourceUrl}
              placeholder="https://www.yoursite.com"
            />
            <Input
              id="site-name-recreate"
              label="Artist / Site name"
              value={siteName}
              onChange={setSiteName}
              placeholder="e.g. Sarah Chen Music"
            />
          </div>
          <div className={styles.actions}>
            <Button
              onClick={handleRecreate}
              isDisabled={!siteName.trim() || !sourceUrl.trim() || isCreating}
            >
              Create site
            </Button>
            <Button variant="ghost" onClick={() => { setMode("choose"); setError(""); }}>
              &larr; Back
            </Button>
          </div>
        </section>
      )}

      {mode === "creating" && (
        <section className={styles.progress}>
          <p className={styles.progressNow} aria-live="polite" aria-atomic="true">
            {PROGRESS_STEPS[progressIndex]}
          </p>
          <ol className={styles.progressList}>
            {PROGRESS_STEPS.map((step, i) => (
              <li
                key={step}
                className={`${styles.progressStep} ${i <= progressIndex ? styles.progressStepOn : ""} ${i === progressIndex ? styles.progressStepCurrent : ""}`}
              >
                {step}
              </li>
            ))}
          </ol>
          <p className={styles.progressHint}>You&rsquo;ll be redirected when it&rsquo;s ready.</p>
        </section>
      )}
    </div>
  );
}
