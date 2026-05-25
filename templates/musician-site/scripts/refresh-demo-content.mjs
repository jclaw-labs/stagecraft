#!/usr/bin/env node
/**
 * Refresh time-sensitive committed demo content so the dev / bundled demo
 * doesn't drift into an empty state as dates pass.
 *
 * Today that's just the `tour-dates` demo items: their dates are regenerated
 * a few months out from "now" — the same +3 / +4 month offsets the welcome
 * wizard's first-run seed uses, so the committed demo previews exactly what a
 * freshly provisioned artist site shows. Static committed dates inherently
 * age; run `npm run refresh:demo` before showcasing or re-screenshotting the
 * demo to bring them current. (Real artist sites are seeded relative-to-now
 * by the welcome flow and are unaffected.)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tourItemsDir = join(here, "..", "src", "content", "collections", "tour-dates", "items");

/** now + `months`, normalised to 20:00 UTC (matches first-run-seeds `addMonths`). */
function monthsOut(months) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCHours(20, 0, 0, 0);
  return d.toISOString();
}

const refreshes = [
  { file: "mercury-lounge-new-york.json", date: monthsOut(3) },
  { file: "mississippi-studios-portland.json", date: monthsOut(4) },
];

const now = new Date().toISOString();
for (const { file, date } of refreshes) {
  const path = join(tourItemsDir, file);
  const item = JSON.parse(readFileSync(path, "utf8"));
  item.values.fld_tour_dates_date.value = date;
  item.updatedAt = now;
  writeFileSync(path, `${JSON.stringify(item, null, 2)}\n`);
  console.log(`refreshed ${file} → ${date}`);
}
