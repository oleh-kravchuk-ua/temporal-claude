/**
 * The most a single activity attempt may run (`startToCloseTimeout`). One constant with no
 * imports, so the workflow can use it and activity adapters can derive their own I/O timeouts
 * from it (an adapter's timeout must stay below this, or a hung call outlives its attempt).
 */
export const ACTIVITY_START_TO_CLOSE_MS = 60_000;
