import { describe, it, expect } from 'vitest';

import { summarize } from './latency-stats';

describe('summarize', () => {
  it('reports count, min, median and max', () => {
    expect(summarize([300, 100, 200])).toEqual({ calls: 3, minMs: 100, medianMs: 200, maxMs: 300 });
  });

  it('handles a single sample', () => {
    expect(summarize([42])).toEqual({ calls: 1, minMs: 42, medianMs: 42, maxMs: 42 });
  });

  it('takes the mean of the two middle values for an even count, rounded', () => {
    expect(summarize([100, 201, 300, 400])).toEqual({
      calls: 4,
      minMs: 100,
      medianMs: 251,
      maxMs: 400,
    });
  });

  it('does not mutate its input', () => {
    const values = [3, 1, 2];

    summarize(values);

    expect(values).toEqual([3, 1, 2]);
  });

  it('rejects an empty sample set', () => {
    expect(() => summarize([])).toThrow(/no samples/i);
  });
});
