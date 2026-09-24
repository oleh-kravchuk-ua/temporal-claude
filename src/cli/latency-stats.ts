/** Small pure helper for the latency benchmark in `claude-check.ts`. */

export interface LatencySummary {
  readonly calls: number;
  readonly minMs: number;
  readonly medianMs: number;
  readonly maxMs: number;
}

export const summarize = (samplesMs: readonly number[]): LatencySummary => {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const [min] = sorted;
  const max = sorted.at(-1);

  if (min === undefined || max === undefined) {
    throw new Error('Cannot summarize: no samples');
  }

  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? (sorted[middle] ?? min)
      : Math.round(((sorted[middle - 1] ?? min) + (sorted[middle] ?? max)) / 2);

  return { calls: sorted.length, minMs: min, medianMs: median, maxMs: max };
};
