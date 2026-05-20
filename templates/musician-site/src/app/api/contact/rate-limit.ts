/**
 * In-memory per-IP rate limiter for the contact route. Pulled into its
 * own module because Next.js route files only allow handler exports;
 * the reset helper used by tests has to live here.
 *
 * Under serverless scale-out each instance gets its own map, so this
 * is a best-effort throttle rather than a strict ceiling — same trade
 * the legacy Astro template made.
 */

const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 3;

const recentByIp = new Map<string, number[]>();

export function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const previous = recentByIp.get(ip) ?? [];
  const recent = previous.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
    recentByIp.set(ip, recent);
    return true;
  }
  recent.push(now);
  recentByIp.set(ip, recent);
  return false;
}

/** Test-only: clear the in-memory rate limiter between cases. */
export function __resetRateLimiterForTests(): void {
  recentByIp.clear();
}

export function clientIp(request: Request): string {
  // Vercel/Netlify set `x-forwarded-for`. Fall back to a stable bucket
  // so the limiter still kicks in under direct connections (dev).
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
