/**
 * Builds the Fastify app (helmet + cors + error handler + agent routes) from injected deps.
 * Side-effect free — no server start, no process.env reads — so it's reusable by the entry
 * point (`server.ts`) and by endpoint e2e tests.
 */

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
  const app = Fastify({ logger: deps.logger ?? false });
  await app.register(helmet);
  await app.register(cors, { origin: deps.corsOrigin });
  registerErrorHandler(app);
  registerAgentRoutes(app, { client: deps.client, taskQueue: deps.taskQueue });
  return app;
};
