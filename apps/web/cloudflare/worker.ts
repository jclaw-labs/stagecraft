/**
 * Cloudflare Worker entry (wrangler.jsonc `main`). Wraps the handler that
 * `opennextjs-cloudflare build` generates in .open-next/ and adds the
 * `scheduled` handler for the Cron Trigger.
 *
 * .open-next/worker.js only exists after `npm run build:worker`, so
 * open-next-worker.d.ts declares its type and this file is typechecked with
 * the rest of the app. wrangler (esbuild) bundles it. The logic lives in
 * scheduled.ts, which is tested.
 */
import handler from "../.open-next/worker.js";

import { runScheduledDrain, type ScheduledEnv, type StagecraftWorker } from "./scheduled";

const worker = {
  fetch: handler.fetch,
  async scheduled(_controller, env, ctx) {
    await runScheduledDrain(handler.fetch, env, ctx);
  },
} satisfies StagecraftWorker<ScheduledEnv>;

export default worker;
