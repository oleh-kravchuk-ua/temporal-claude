/**
 * Vitest setup: install a quiet Temporal runtime before any worker/test-env starts, so the
 * test output isn't flooded with SDK "Worker state changed" INFO lines or the Rust-core
 * heartbeat-capability WARN (harmless here — our activities don't use heartbeats).
 *
 * Runs once per test-worker process; a second install throws and is ignored (the quiet
 * runtime is already active).
 */

import { DefaultLogger, Runtime, makeTelemetryFilterString } from '@temporalio/worker';

try {
  Runtime.install({
    logger: new DefaultLogger('ERROR'),
    telemetryOptions: {
      logging: { filter: makeTelemetryFilterString({ core: 'ERROR', other: 'ERROR' }) },
    },
  });
} catch {
  // Runtime already installed in this process — the quiet configuration is already active.
}
