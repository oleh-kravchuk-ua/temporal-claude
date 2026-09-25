/**
 * Time and retry limits for one activity call, in one place with no imports, so the workflow can
 * use them and activity adapters can derive their own limits from them.
 *
 * - `ACTIVITY_START_TO_CLOSE_MS`: the most a single attempt may run. An adapter's own I/O timeout
 *   must stay below this, or a hung call outlives its attempt.
 * - `ACTIVITY_RETRY`: a transient failure (rate limit, overload, network) is retried up to 4 times
 *   in all, waiting 2 s, 4 s, 8 s (capped at 30 s). A failure can override the wait with its own
 *   `nextRetryDelay` (the Claude adapter passes the server's `retry-after`).
 */
export const ACTIVITY_START_TO_CLOSE_MS = 60_000;

export const ACTIVITY_RETRY = {
  initialInterval: '2s',
  backoffCoefficient: 2,
  maximumInterval: '30s',
  maximumAttempts: 4,
} as const;
