/**
 * HTTP API entry point: a Fastify server that is a Temporal *client* (it hosts no workflow
 * code). Builds the app via `buildApp`, wires config + the Temporal connection, and listens.
 * Thin adapter — all logic lives in the workflow/activities. Run: `npm run api`.
 */

import { loadConfig } from '../../infra/config';
import { loggerOptions } from '../../infra/logger';
import { createClient } from '../../infra/temporal';
import { buildApp } from './app';

const start = async (): Promise<void> => {
  const config = loadConfig();
  const { client, connection } = await createClient(config);

  const app = await buildApp({
    client,
    taskQueue: config.taskQueue,
    corsOrigin: config.corsOrigin,
    logger: loggerOptions(config),
  });

  const shutdown = async (): Promise<void> => {
    await app.close();
    await connection.close();
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  await app.listen({ host: config.httpHost, port: config.httpPort });
};

start().catch((error: unknown) => {
  console.error('API failed to start:', error);
  process.exitCode = 1;
});
