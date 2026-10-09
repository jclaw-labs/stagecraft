/**
 * Map `items` through `fn` with at most `limit` calls in flight at once.
 *
 * Results come back in input order, like `Promise.all(items.map(fn))`. The
 * first rejection rejects the whole call; calls already running are left to
 * settle, and no new ones start after it.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`mapWithConcurrency: limit must be a positive integer, got ${limit}`);
  }

  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;

  async function lane(): Promise<void> {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index], index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }

  const lanes = Array.from({ length: Math.min(limit, items.length) }, () => lane());
  await Promise.all(lanes);
  return results;
}
