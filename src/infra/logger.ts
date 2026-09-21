/**
 * Logging: a shared pino logger built from `AppConfig`. Pretty-printed in non-production,
 * structured JSON in production. Used by the worker, activities, API, and CLI.
 *
 * NOTE: workflow code must NOT use this — workflows log via `@temporalio/workflow`'s `log`
 * (sinks) to stay deterministic. See SPEC §6a-bis.
 */

import { pino, type Logger } from 'pino';

import type { AppConfig } from './config';

export const createLogger = (config: AppConfig): Logger =>
  pino({
    level: config.logLevel,
    ...(config.nodeEnv === 'production'
      ? {}
      : { transport: { target: 'pino-pretty', options: { colorize: true } } }),
  });
