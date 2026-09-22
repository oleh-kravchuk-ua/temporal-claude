/**
 * Builds the Fastify app (helmet + cors + error handler + agent routes) from injected deps.
 * Side-effect free — no server start, no process.env reads — so it's reusable by the entry
 * point (`server.ts`) and by endpoint e2e tests.
 */

import { randomUUID } from 'node:crypto';

import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { Client } from '@temporalio/client';
import Fastify, { type FastifyInstance } from 'fastify';
import type { LoggerOptions } from 'pino';

import { registerErrorHandler } from './error-handler';
import { registerAgentRoutes } from './routes/agents';

export interface BuildAppDeps {
  readonly client: Client;
  readonly taskQueue: string;
  readonly corsOrigin: string;
  /** pino options, or `false` to disable logging (e.g. in tests). */
  readonly logger?: LoggerOptions | false;
}

export const buildApp = async (deps: BuildAppDeps): Promise<FastifyInstance> => {
  const app = Fastify({
    logger: deps.logger ?? false,
    // One line per request (below) instead of Fastify's default incoming/completed pair.
    disableRequestLogging: true,
    // Correlate with an inbound `x-request-id` when present, else a fresh uuid.
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
  });

  await app.register(helmet);
  await app.register(cors, { origin: deps.corsOrigin });

  // Single access-log line per request (reqId ties it to the handler's own logs), carrying
  // total execution time and a memory snapshot at response time.
  app.addHook('onResponse', (request, reply, done) => {
    const mem = process.memoryUsage();
    const toMB = (bytes: number): number => Math.round(bytes / 1024 / 1024);
    request.log.info(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTimeMs: Math.round(reply.elapsedTime),
        rssMB: toMB(mem.rss),
        heapUsedMB: toMB(mem.heapUsed),
      },
      'request',
    );
    done();
  });

  registerErrorHandler(app);
  registerAgentRoutes(app, { client: deps.client, taskQueue: deps.taskQueue });
  return app;
};
