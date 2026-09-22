/**
 * Agent REST routes — a thin adapter over the Temporal Client. Each handler validates input
 * (zod) and maps to a start/query/signal; no business logic lives here. Signals are
 * fire-and-forget → `202 Accepted`. Validation and not-found errors are turned into the
 * `{ error }` envelope by the app-level error handler (see server.ts).
 */

import { randomUUID } from 'node:crypto';

import type { Client } from '@temporalio/client';
import type { FastifyInstance } from 'fastify';

import { agentWorkflow } from '../../../application/agent.workflow';

import {
  approvePlan,
  cancelAgent,
  getState,
  provideGuidance,
} from '../../../application/contracts';

import {
  AgentParamsSchema,
  ApproveBodySchema,
  GuidanceBodySchema,
  StartBodySchema,
} from '../schemas';

export interface AgentRoutesDeps {
  readonly client: Client;
  readonly taskQueue: string;
}

export const registerAgentRoutes = (
  app: FastifyInstance,
  { client, taskQueue }: AgentRoutesDeps,
): void => {
  app.get('/healthz', () => ({ data: { status: 'ok' } }));

  // Start a new agent run.
  app.post('/agents', async (request, reply) => {
    const { topic } = StartBodySchema.parse(request.body);
    const workflowId = `agent-${randomUUID()}`;

    await client.workflow.start(agentWorkflow, { taskQueue, workflowId, args: [{ topic }] });
    request.log.info({ workflowId, topic }, 'Started agent workflow');

    return reply.code(201).send({ data: { workflowId } });
  });

  // Read the current state (read-only query).
  app.get('/agents/:id', async (request) => {
    const { id } = AgentParamsSchema.parse(request.params);

    const state = await client.workflow.getHandle(id).query(getState);

    return { data: state };
  });

  // Approve or reject the current plan.
  app.post('/agents/:id/approve', async (request, reply) => {
    const { id } = AgentParamsSchema.parse(request.params);
    const decision = ApproveBodySchema.parse(request.body);

    await client.workflow.getHandle(id).signal(approvePlan, decision);
    request.log.info({ id, approved: decision.approved }, 'Signalled approvePlan');

    return reply.code(202).send();
  });

  // Inject mid-run guidance.
  app.post('/agents/:id/guidance', async (request, reply) => {
    const { id } = AgentParamsSchema.parse(request.params);
    const { guidance } = GuidanceBodySchema.parse(request.body);

    await client.workflow.getHandle(id).signal(provideGuidance, guidance);
    request.log.info({ id }, 'Signalled provideGuidance');

    return reply.code(202).send();
  });

  // Request graceful cancellation.
  app.post('/agents/:id/cancel', async (request, reply) => {
    const { id } = AgentParamsSchema.parse(request.params);

    await client.workflow.getHandle(id).signal(cancelAgent);
    request.log.info({ id }, 'Signalled cancel');

    return reply.code(202).send();
  });
};
