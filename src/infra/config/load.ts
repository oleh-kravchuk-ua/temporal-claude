import { z } from 'zod';

import { readEnv } from './parse-env';
import { AppConfigSchema, type RawEnv, type AppConfig } from './types';

/**
 * Build the typed, frozen config. `env` is injectable for testing; by default it merges the
 * env files and `process.env`. Throws a clear error if any value is invalid.
 */
export const loadConfig = (env: RawEnv = readEnv()): AppConfig => {
  const result = AppConfigSchema.safeParse({
    nodeEnv: env['NODE_ENV'],
    temporalAddress: env['TEMPORAL_ADDRESS'],
    temporalNamespace: env['TEMPORAL_NAMESPACE'],
    taskQueue: env['TEMPORAL_TASK_QUEUE'],
    temporalApiKey: env['TEMPORAL_API_KEY'],
    httpPort: env['HTTP_PORT'],
    httpHost: env['HTTP_HOST'],
    corsOrigin: env['CORS_ORIGIN'],
    logLevel: env['LOG_LEVEL'],
  });

  if (!result.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(result.error)}`);
  }

  return Object.freeze(result.data);
};
