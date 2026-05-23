import { createWorker } from "@stagecraft/queue";
import { handleMigrateSite } from "./migrate-site";

let workerInstance: ReturnType<typeof createWorker> | null = null;

export function getWorker() {
  if (!workerInstance) {
    workerInstance = createWorker({
      handlers: {
        // create_site is no longer handled by the worker — it runs
        // synchronously inside POST /api/sites. Lambda's HTTP request
        // lifecycle freezes async work as soon as the handler returns,
        // which left poll-based create_site jobs stuck in `running`
        // indefinitely. The synchronous path blocks the request for
        // ~5-10s but always reaches a terminal state.
        migrate_site: handleMigrateSite,
      },
      pollIntervalMs: 3000,
    });
  }
  return workerInstance;
}
