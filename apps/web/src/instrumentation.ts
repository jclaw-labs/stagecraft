export async function register() {
  // Start the in-process job poller on the server side only. Hosts with no
  // long-lived process (e.g. Cloudflare Workers) set
  // STAGECRAFT_INPROCESS_WORKER=false and drive the queue through
  // POST /api/cron/jobs on a schedule instead.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.STAGECRAFT_INPROCESS_WORKER !== "false") {
    const { getWorker } = await import("@/lib/jobs/worker");
    getWorker().start();
  }
}
