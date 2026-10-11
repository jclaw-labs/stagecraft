"use client";

import { useState } from "react";
import Button from "@/components/Button";
import type { UpgradeQueueRefusal } from "@/lib/jobs/queue-upgrade";

import styles from "./dashboard.module.css";

interface UpgradeRunResult {
  packageVersion: string;
  queued: Array<{ id: string; name: string }>;
  skipped: Array<{ id: string; name: string; reason: UpgradeQueueRefusal }>;
}

const SKIP_REASONS: Record<UpgradeQueueRefusal, string> = {
  in_flight: "an upgrade is already running",
  no_repo: "no GitHub repository",
  not_active: "not live",
};

/**
 * Platform-admin action: queue an upgrade for every live site on the
 * platform, whoever owns it (`POST /api/admin/upgrade-sites`, ADR-016 §4).
 * Each site's job opens or updates its own upgrade pull request; a
 * customized site reports its changed files on its own page instead.
 *
 * Rendered only for admins (see DashboardPage); the route enforces the
 * allowlist either way.
 */
export function UpgradeAllSitesButton() {
  const [phase, setPhase] = useState<"idle" | "confirming" | "working" | "done" | "error">("idle");
  const [result, setResult] = useState<UpgradeRunResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleRun() {
    setPhase("working");
    setErrorMessage("");
    try {
      const res = await fetch("/api/admin/upgrade-sites", { method: "POST" });
      const body = (await res.json()) as UpgradeRunResult | { error?: string };
      if (!res.ok || !("queued" in body)) {
        setPhase("error");
        setErrorMessage(("error" in body && body.error) || `HTTP ${res.status}`);
        return;
      }
      setResult(body);
      setPhase("done");
    } catch (cause) {
      setPhase("error");
      setErrorMessage(cause instanceof Error ? cause.message : "Network error");
    }
  }

  return (
    <div className={styles.adminTool}>
      <h3 className={styles.adminToolTitle}>Upgrade every site</h3>
      <p className={styles.adminToolText}>
        Queue an upgrade for every live site on the platform. Each one opens or updates a pull request on its
        repository, using its owner&rsquo;s GitHub sign-in. A site whose code was changed by hand gets no pull
        request; its page lists the changed files instead.
      </p>

      {phase === "idle" && (
        <Button variant="secondary" size="sm" onClick={() => setPhase("confirming")}>
          Upgrade all sites&hellip;
        </Button>
      )}

      {phase === "confirming" && (
        <div className={styles.adminToolActions}>
          <Button size="sm" onClick={handleRun}>
            Yes, queue upgrades
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPhase("idle")}>
            Cancel
          </Button>
        </div>
      )}

      {phase === "working" && <p className={styles.adminToolText}>Queuing upgrades&hellip;</p>}

      {phase === "done" && result && (
        <div className={styles.adminToolResult} role="status">
          <p className={styles.adminToolText}>
            Queued {result.queued.length} upgrade{result.queued.length === 1 ? "" : "s"} to {result.packageVersion}.
            {result.skipped.length > 0 && ` Skipped ${result.skipped.length}:`}
          </p>
          {result.skipped.length > 0 && (
            <ul className={styles.adminToolList}>
              {result.skipped.map((site) => (
                <li key={site.id}>
                  {site.name} ({SKIP_REASONS[site.reason]})
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {phase === "error" && (
        <p className={styles.adminToolError} role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
