# scripts/

Maintenance / one-off scripts. Run with `node scripts/<name>.mjs` (ESM).

- **`refresh-demo-content.mjs`** (`npm run refresh:demo`) — regenerate the
  committed demo's time-sensitive content (the `tour-dates` items) a few
  months out from today, using the same offsets the welcome wizard's
  first-run seed uses. Static committed dates inherently age into the
  empty “no upcoming shows” state; run this before showcasing or
  re-screenshotting the dev / bundled demo. Real artist sites are seeded
  relative-to-now by the welcome flow and don't need it.
- **`run-pr3-migration.mjs`** — one-shot content migration (historical).
