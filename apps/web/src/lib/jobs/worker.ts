import { after } from "next/server";
import { createWorker } from "@stagecraft/queue";
import { handleCreateSite } from "./create-site";
import { handleMigrateSite } from "./migrate-site";

let workerInstance: ReturnType<typeof createWorker> | null = null;

export function getWorker() {
  if (!workerInstance) {
    workerInstance = createWorker({
      handlers: {
        create_site: handleCreateSite,
        migrate_site: handleMigrateSite,
      },
      pollIntervalMs: 3000,
    });
  }
  return workerInstance;
}

/**
 * After the current response is sent, run one queued job in this
 * invocation. Call it from a route handler right after enqueueing.
 *
 * Only on hosts that use the in-process poller (STAGECRAFT_INPROCESS_WORKER
 * not "false"), which today means Netlify: its functions freeze once the
 * response is sent, so the poller can't be relied on to pick the job up,
 * while `after()` keeps the invocation alive until the drain finishes.
 * Hosts with a cron drain (the Cloudflare Worker) leave it to the cron. If
 * the invocation dies part way anyway, the job's lease expires and the next
 * drain resumes it from its last finished step.
 */
export function drainAfterResponse(): void {
  if (process.env.STAGECRAFT_INPROCESS_WORKER === "false") return;
  after(async () => {
    try {
      await getWorker().drain({ maxJobs: 1 });
    } catch (error) {
      console.error(
        JSON.stringify({ event: "worker.after_drain_error", error: String(error), ts: new Date().toISOString() }),
      );
    }
  });
}
