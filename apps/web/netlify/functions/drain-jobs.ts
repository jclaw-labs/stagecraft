/**
 * Netlify scheduled function: drains the job queue every five minutes.
 *
 * Routes that enqueue a job already run it right after their response
 * (`drainAfterResponse`), but a Netlify function can be cut off part way.
 * Once that job's lease expires, only a later enqueue or a warm function
 * would pick it up again, and neither is guaranteed. This bounds that delay. It needs CRON_SECRET set on the Netlify
 * project (docs/runbook.md); Netlify sets URL to the site's primary URL.
 */
import { requestCronDrain } from "../../src/lib/jobs/cron-drain";

export default async function drainJobs(): Promise<void> {
  await requestCronDrain((request) => fetch(request), process.env.CRON_SECRET, process.env.URL);
}

export const config = { schedule: "*/5 * * * *" };
