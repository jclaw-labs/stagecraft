import fs from "node:fs";
import path from "node:path";

import { chromium, type LaunchOptions } from "@playwright/test";

// Claude Code cloud sessions can't download Playwright's managed browser
// (the download CDN is blocked), but ship a compatible Chromium under
// /opt/pw-browsers — often a different build number than the one this
// Playwright expects. Pointing `launchOptions.executablePath` straight at
// that binary bypasses Playwright's version/registry checks entirely, so
// the build-number mismatch doesn't matter. Local dev and CI download
// browsers normally, where this is a no-op (Playwright's own browser is
// found and used unchanged).
const PREINSTALLED_ROOT = "/opt/pw-browsers";

export function captureLaunchOptions(): LaunchOptions {
  let managed: string | undefined;
  try {
    managed = chromium.executablePath();
  } catch {
    managed = undefined;
  }
  // Playwright's managed browser is present — the normal path.
  if (managed && fs.existsSync(managed)) return {};

  const preinstalled = findPreinstalledChromium();
  // Nothing pre-installed either: return {} and let Playwright fail with
  // its own "run npx playwright install" guidance.
  if (!preinstalled) return {};

  const args: string[] = [];
  // Chrome refuses to run as root without --no-sandbox, and cloud sessions
  // run as root. Scoped to the pre-installed path, so CI/local are untouched.
  if (process.getuid?.() === 0) args.push("--no-sandbox");
  return { executablePath: preinstalled, args };
}

function findPreinstalledChromium(): string | undefined {
  if (!fs.existsSync(PREINSTALLED_ROOT)) return undefined;
  const entries = fs.readdirSync(PREINSTALLED_ROOT);

  // Prefer the headless shell — it matches Playwright's default headless
  // mode and launches as root without extra flags — then fall back to the
  // full chrome binary. Each candidate covers both the current
  // (`chrome-headless-shell-linux64`) and older (`chrome-linux`) layouts.
  const candidates = [
    ...entries
      .filter((e) => e.startsWith("chromium_headless_shell-"))
      .flatMap((e) => [
        path.join(PREINSTALLED_ROOT, e, "chrome-headless-shell-linux64", "chrome-headless-shell"),
        path.join(PREINSTALLED_ROOT, e, "chrome-linux", "headless_shell"),
      ]),
    ...entries
      .filter((e) => e.startsWith("chromium-"))
      .flatMap((e) => [
        path.join(PREINSTALLED_ROOT, e, "chrome-linux64", "chrome"),
        path.join(PREINSTALLED_ROOT, e, "chrome-linux", "chrome"),
      ]),
  ];
  return candidates.find((p) => fs.existsSync(p));
}
