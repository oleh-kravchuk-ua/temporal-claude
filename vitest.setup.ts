/**
 * Vitest setup: install a quiet Temporal runtime before any worker/test-env starts, so the
 * test output isn't flooded with SDK "Worker state changed" INFO lines or the Rust-core
 * heartbeat-capability WARN (harmless here — our activities don't use heartbeats).
 *
 * Runs once per test-worker process; a second install throws and is ignored (the quiet
 * runtime is already active).
 *
 * Errors are still printed, with one exception: a test that fails a run ON PURPOSE (to check how
 * failures are reported) uses a task queue whose name starts with `expected-failure-`, and the
 * workflow's own `Agent run failed` error from that queue is dropped. Without this, a passing
 * suite prints what looks like a real failure. Any other error still shows.
 */

import {
  DefaultLogger,
  Runtime,
  makeTelemetryFilterString,
  type LogLevel,
  type LogMetadata,
} from '@temporalio/worker';

const EXPECTED_FAILURE_QUEUE_PREFIX = 'expected-failure-';

class TestLogger extends DefaultLogger {
  override log(level: LogLevel, message: string, meta?: LogMetadata): void {
    const queue: unknown = meta?.['taskQueue'];
    const expected = typeof queue === 'string' && queue.startsWith(EXPECTED_FAILURE_QUEUE_PREFIX);
    if (level === 'ERROR' && expected) return;
    super.log(level, message, meta);
  }
}

try {
  Runtime.install({
    logger: new TestLogger('ERROR'),
    telemetryOptions: {
      logging: { filter: makeTelemetryFilterString({ core: 'ERROR', other: 'ERROR' }) },
    },
  });
} catch {
  // Runtime already installed in this process — the quiet configuration is already active.
}
