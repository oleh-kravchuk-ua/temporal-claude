import { z } from 'zod';

import { readEnv } from './read-env';
import { AppConfigSchema, type RawEnv, type AppConfig } from './types';

/**
 * Build the typed, frozen config. `env` is injectable for testing; by default it merges the
 * env files and `process.env`. Throws a clear error if any value is invalid.
 */
export const loadConfig = (env: RawEnv = readEnv()): AppConfig => {
  const result = AppConfigSchema.safeParse({
    nodeEnv: env['NODE_ENV'],
    logLevel: env['LOG_LEVEL'],
    http: {
      port: env['HTTP_PORT'],
      host: env['HTTP_HOST'],
    },
    corsOrigin: env['CORS_ORIGIN'],
    temporal: {
      connection: {
        address: env['TEMPORAL_ADDRESS'],
        namespace: env['TEMPORAL_NAMESPACE'],
        apiKey: env['TEMPORAL_API_KEY'],
      },
      taskQueue: env['TEMPORAL_TASK_QUEUE'],
    },
  });

  if (!result.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(result.error)}`);
  }

  return Object.freeze(result.data);
};
