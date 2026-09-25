/**
 * Logging: a shared pino logger built from `AppConfig`. Pretty-printed in non-production,
 * structured JSON in production. Used by the worker, activities, API, and CLI.
 *
 * NOTE: workflow code must NOT use this — workflows log via `@temporalio/workflow`'s `log`
 * (sinks) to stay deterministic. See CLAUDE.md (Toolchain / conventions → Logging).
 */

import { pino, type Logger, type LoggerOptions } from 'pino';

import type { AppConfig } from './config';

/** pino options derived from config — shared so Fastify and the worker/CLI log identically. */
export const loggerOptions = (config: AppConfig): LoggerOptions => ({
  level: config.logLevel,
  // Never log secrets/credentials, wherever a request or headers object is logged.
  redact: [
    'req.headers.authorization',
    'req.headers.cookie',
    'headers.authorization',
    'headers.cookie',
    'apiKey',
    'temporalApiKey',
    // Nested: a config object (or its `ai` / `temporal` groups) logged by mistake.
    '*.apiKey',
    '*.temporalApiKey',
    'ai.apiKey',
    'temporal.connection.apiKey',
    'config.ai.apiKey',
    'config.temporal.connection.apiKey',
  ],
  ...(config.nodeEnv === 'production'
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true } } }),
});

export const createLogger = (config: AppConfig): Logger => pino(loggerOptions(config));
