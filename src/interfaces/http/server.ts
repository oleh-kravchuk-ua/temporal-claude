/**
 * HTTP API entry point: a Fastify server that is a Temporal *client* (it hosts no workflow
 * code). Exposes the human-in-the-loop REST surface, secured with helmet + cors, logging via
 * pino. Thin adapter — all logic lives in the workflow/activities. Run: `npm run api`.
 */

import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { WorkflowNotFoundError } from '@temporalio/client';
import Fastify from 'fastify';
import { ZodError } from 'zod';

import { loadConfig } from '../../infra/config';
import { loggerOptions } from '../../infra/logger';
import { createClient } from '../../infra/temporal';
import { registerAgentRoutes } from './routes/agents';

const start = async (): Promise<void> => {
  const config = loadConfig();
  const { client, connection } = await createClient(config);

  const app = Fastify({ logger: loggerOptions(config) });

  await app.register(helmet);
  await app.register(cors, { origin: config.corsOrigin });

  // Consistent { error } envelope + status mapping for the whole API.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: error.issues },
      });
    }
    if (error instanceof WorkflowNotFoundError) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Workflow not found' } });
    }
    request.log.error(error);
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Internal server error' } });
  });

  registerAgentRoutes(app, { client, taskQueue: config.taskQueue });

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
