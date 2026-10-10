# scripts/

Maintenance / one-off scripts. Run with `node scripts/<name>.mjs` (ESM).

- **`refresh-demo-content.mjs`** (`npm run refresh:demo`) — regenerate the
  committed demo's time-sensitive content (the `tour-dates` items) a few
  months out from today, using the same offsets the welcome wizard's
  first-run seed uses. Static committed dates inherently age into the
  empty “no upcoming shows” state; run this before showcasing or
  re-screenshotting the dev / bundled demo. Real artist sites are seeded
  relative-to-now by the welcome flow and don't need it.
- **`migrate-block-library.mjs`** — one-shot content migration for the
  merged block library (#349). Rewrites template layouts and item bodies
  written with the old template primitives (Section `narrow / default /
  wide` + `padding`, Button `label`, Image `src`, `RichTextRender`) into
  the one library's vocabulary. Page bodies are already in it and come out
  unchanged. `node scripts/migrate-block-library.mjs [contentDir] [--check]`;
  idempotent. It imports the TypeScript migration module directly, which
  Node runs natively from 22.18; on 22.12–22.17 (the `engines` floor) add
  `--experimental-strip-types`.
- **`run-pr3-migration.mjs`** — one-shot content migration (historical).
