/**
 * Calls the queue's cron drain route (`POST /api/cron/jobs`). Used by the
 * Netlify scheduled function (netlify/functions/drain-jobs.ts).
 */

export const CRON_JOBS_PATH = "/api/cron/jobs";

/** Builds the authenticated drain request on `siteUrl`'s origin. */
export function buildCronRequest(secret: string, siteUrl: string): Request {
  return new Request(new URL(CRON_JOBS_PATH, new URL(siteUrl).origin), {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
}

/**
 * Sends one drain request through `send`. Throws when the secret or site URL
 * is missing or the route answers non-2xx, so the scheduler records the run
 * as failed instead of silently doing nothing.
 */
export async function requestCronDrain(
  send: (request: Request) => Promise<Response>,
  secret: string | undefined,
  siteUrl: string | undefined,
): Promise<void> {
  if (!secret) {
    throw new Error("CRON_SECRET is not set; the scheduled drain cannot run the job queue");
  }
  if (!siteUrl) {
    throw new Error("The site URL is not set; the scheduled drain has nowhere to send the request");
  }

  const response = await send(buildCronRequest(secret, siteUrl));
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${CRON_JOBS_PATH} returned ${response.status}: ${body}`);
  }
}
