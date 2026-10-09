/**
 * Cloudflare Worker entry (wrangler.jsonc `main`). Wraps the handler that
 * `opennextjs-cloudflare build` generates in .open-next/ and adds the
 * `scheduled` handler for the Cron Trigger.
 *
 * Excluded from the app's tsconfig: .open-next/worker.js only exists after
 * `npm run build:worker`, and wrangler (esbuild) bundles this file. The
 * logic lives in scheduled.ts, which is typechecked and tested.
 */
import handler from "../.open-next/worker.js";

import { runScheduledDrain } from "./scheduled";

const worker = {
  fetch: handler.fetch,
  async scheduled(_controller, env, ctx) {
    await runScheduledDrain(handler.fetch, env, ctx);
  },
};

export default worker;
