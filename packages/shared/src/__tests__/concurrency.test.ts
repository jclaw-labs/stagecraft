import { describe, expect, it } from "vitest";

import { mapWithConcurrency } from "../concurrency";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("mapWithConcurrency", () => {
  it("returns results in input order", async () => {
    const delays = [30, 5, 15, 0];
    const result = await mapWithConcurrency(delays, 2, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return i * 10;
    });
    expect(result).toEqual([0, 10, 20, 30]);
  });

  it("never runs more than `limit` calls at once", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
    });
    expect(peak).toBe(3);
  });

  it("returns an empty array for no items without calling fn", async () => {
    let calls = 0;
    const result = await mapWithConcurrency([], 4, async () => {
      calls++;
    });
    expect(result).toEqual([]);
    expect(calls).toBe(0);
  });

  it("rejects with the first error and starts no new calls after it", async () => {
    const gate = deferred<void>();
    const started: number[] = [];
    const run = mapWithConcurrency([0, 1, 2, 3, 4], 2, async (n) => {
      started.push(n);
      if (n === 0) throw new Error("boom");
      await gate.promise;
      return n;
    });
    await expect(run).rejects.toThrow("boom");
    gate.resolve();
    await new Promise((r) => setTimeout(r, 0));
    // 0 failed, 1 was already running; nothing past it starts.
    expect(started).toEqual([0, 1]);
  });

  it.each([0, -1, 1.5, Number.NaN])("throws on a non-positive-integer limit (%s)", async (limit) => {
    await expect(mapWithConcurrency([1], limit, async (n) => n)).rejects.toThrow(RangeError);
  });
});
