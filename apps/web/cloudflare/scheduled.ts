/**
 * Cron Trigger handler for the Cloudflare Worker build (see wrangler.jsonc).
 *
 * Workers have no long-lived process, so the in-process poller from
 * instrumentation.ts never ticks there. Every minute the Cron Trigger calls
 * this, which hands `POST /api/cron/jobs` straight to the OpenNext fetch
 * handler (no network hop). The route authenticates the call and drains the
 * job queue, so the queue logic stays in one place for every host.
 */

export const CRON_JOBS_PATH = "/api/cron/jobs";

/**
 * Fallback origin for the in-process request, used only when AUTH_URL is
 * unset or not a valid URL. The host never resolves, because the request goes
 * straight to the handler, but the origin is not inert: OpenNext sets
 * `__NEXT_PRIVATE_ORIGIN` from the first request an isolate handles, and Next
 * builds the fetch URL for app-relative server-action redirects from it. A
 * cron tick that starts a fresh isolate would pin this placeholder for every
 * later request in that isolate, which is why the app's real origin comes
 * first.
 */
export const CRON_REQUEST_ORIGIN = "https://cron.internal";

/**
 * The Worker bindings this handler reads. CRON_SECRET is a Worker secret;
 * AUTH_URL is the app's base URL (see docs/runbook.md).
 */
export interface ScheduledEnv {
  CRON_SECRET?: string;
  AUTH_URL?: string;
}

/** The subset of Cloudflare's ExecutionContext the fetch handler needs. */
export interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export type WorkerFetch<Env extends ScheduledEnv> = (
  request: Request,
  env: Env,
  ctx: WorkerExecutionContext,
) => Promise<Response>;

/**
 * The Worker entry's shape (cloudflare/worker.ts). Typing the entry against
 * it makes typecheck fail if the `scheduled` wiring is dropped or its
 * arguments are passed in the wrong order.
 */
export interface StagecraftWorker<Env extends ScheduledEnv> {
  fetch: WorkerFetch<Env>;
  scheduled(controller: unknown, env: Env, ctx: WorkerExecutionContext): Promise<void>;
}

/**
 * The origin the cron request is built on: AUTH_URL's origin when it parses
 * as an http(s) URL, otherwise CRON_REQUEST_ORIGIN.
 */
export function cronRequestOrigin(authUrl: string | undefined): string {
  if (!authUrl) return CRON_REQUEST_ORIGIN;
  try {
    const url = new URL(authUrl);
    if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
  } catch {
    // Not a URL: fall through to the placeholder.
  }
  return CRON_REQUEST_ORIGIN;
}

/** Builds the authenticated request the Cron Trigger sends to the drain route. */
export function buildCronRequest(secret: string, authUrl?: string): Request {
  return new Request(new URL(CRON_JOBS_PATH, cronRequestOrigin(authUrl)), {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
}

/**
 * Runs one queue drain through the Worker's own fetch handler. Throws when the
 * secret is missing or the route answers non-2xx, so Cloudflare records the
 * cron invocation as failed instead of silently doing nothing.
 */
export async function runScheduledDrain<Env extends ScheduledEnv>(
  fetchHandler: WorkerFetch<Env>,
  env: Env,
  ctx: WorkerExecutionContext,
): Promise<void> {
  const secret = env.CRON_SECRET;
  if (!secret) {
    throw new Error("CRON_SECRET is not set; the Cron Trigger cannot drain the job queue");
  }

  const response = await fetchHandler(buildCronRequest(secret, env.AUTH_URL), env, ctx);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${CRON_JOBS_PATH} returned ${response.status}: ${body}`);
  }
}
