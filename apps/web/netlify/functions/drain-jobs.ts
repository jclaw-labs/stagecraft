/**
 * Netlify scheduled function: drains the job queue every five minutes.
 *
 * Routes that enqueue a job already run it right after their response
 * (`drainAfterResponse`), but a Netlify function can be cut off part way, and
 * nothing else picks the job up again once its lease expires. This is the
 * safety net that resumes those jobs. It needs CRON_SECRET set on the Netlify
 * project (docs/runbook.md); Netlify sets URL to the site's primary URL.
 */
import { requestCronDrain } from "../../src/lib/jobs/cron-drain";

export default async function drainJobs(): Promise<void> {
  await requestCronDrain((request) => fetch(request), process.env.CRON_SECRET, process.env.URL);
}

export const config = { schedule: "*/5 * * * *" };
