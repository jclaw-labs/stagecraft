/**
 * In-memory per-IP rate limiter for the contact route. Pulled into its
 * own module because Next.js route files only allow handler exports;
 * the reset helper used by tests has to live here.
 *
 * Under serverless scale-out each instance gets its own map, so this
 * is a best-effort throttle rather than a strict ceiling — same trade
 * the legacy Astro template made.
 *
 * Memory: entries age out automatically when their last timestamp
 * leaves the window, and a hard cap on map size keeps the worst case
 * bounded if a wave of unique IPs hits before old entries get pruned.
 */

const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 3;
const MAX_TRACKED_IPS = 10_000;

const recentByIp = new Map<string, number[]>();

function sweepIfFull(now: number): void {
  if (recentByIp.size < MAX_TRACKED_IPS) return;
  // Drop every IP whose newest timestamp has already left the window.
  // Anyone with a fresh request inside the window is preserved.
  for (const [ip, timestamps] of recentByIp) {
    const newest = timestamps[timestamps.length - 1] ?? 0;
    if (now - newest >= RATE_LIMIT_WINDOW_MS) recentByIp.delete(ip);
  }
  // If the sweep didn't free anything (every tracked IP is actively
  // hammering), Map iteration order is insertion order — drop the
  // oldest insertion. Bounded growth beats accuracy under attack.
  if (recentByIp.size >= MAX_TRACKED_IPS) {
    const oldestKey = recentByIp.keys().next().value;
    if (oldestKey !== undefined) recentByIp.delete(oldestKey);
  }
}

export function isRateLimited(ip: string): boolean {
  const now = Date.now();
  sweepIfFull(now);
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
