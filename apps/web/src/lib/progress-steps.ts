/**
 * Pick which step to show based on how long the operation has been running.
 *
 * The /create flow runs synchronously for ~5-10 seconds. Rather than show a
 * single "Creating…" spinner the whole time, we cycle through ordered status
 * messages on a timer so the user gets a sense of progress + what's
 * happening behind the scenes. The cycling is open-loop (time-based, not
 * actually wired to backend events) — adequate because the steps run in a
 * deterministic order, but it does mean the displayed step is an
 * approximation of what's really happening server-side.
 *
 * Saturates at the last step so we never run off the end if the request
 * outlives the cycle.
 */
export function pickStepIndex(
  elapsedMs: number,
  intervalMs: number,
  totalSteps: number,
): number {
  if (totalSteps <= 0) return 0;
  if (elapsedMs < 0) return 0;
  return Math.min(Math.floor(elapsedMs / intervalMs), totalSteps - 1);
}
