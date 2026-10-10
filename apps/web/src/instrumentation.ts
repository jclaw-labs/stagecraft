export async function register() {
  // Start the in-process job poller on the server side only. A host with no
  // long-lived process at all sets STAGECRAFT_INPROCESS_WORKER=false and
  // drives the queue through POST /api/cron/jobs on a schedule instead.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.STAGECRAFT_INPROCESS_WORKER !== "false") {
    const { getWorker } = await import("@/lib/jobs/worker");
    getWorker().start();
  }
}
