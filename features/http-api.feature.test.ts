/**
 * Endpoint e2e: the real Fastify app → real Temporal client → real worker → real activities →
 * real workflow, all wired to a time-skipping test server. Exercises the HTTP surface end to
 * end (no mocks), which is why the HTTP layer has no separate unit tests.
 */

import { fileURLToPath } from 'node:url';

import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker, bundleWorkflowCode, type WorkflowBundle } from '@temporalio/worker';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pino } from 'pino';

import { createAiToolsActivities } from '../src/infra/activities/ai-tools';
import { buildApp } from '../src/interfaces/http/app';

const TASK_QUEUE = 'test';

let env: TestWorkflowEnvironment;
let worker: Worker;
let workerRun: Promise<void>;
let app: FastifyInstance;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
  const bundle: WorkflowBundle = await bundleWorkflowCode({
    workflowsPath: fileURLToPath(new URL('../src/application/agent.workflow.ts', import.meta.url)),
  });
  worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowBundle: bundle,
    activities: createAiToolsActivities(pino({ level: 'silent' })),
  });
  workerRun = worker.run();
  app = await buildApp({ client: env.client, taskQueue: TASK_QUEUE, corsOrigin: '*' });
  await app.ready();
}, 60_000);

afterAll(async () => {
  worker.shutdown();
  await workerRun;
  await app.close();
  await env.teardown();
});

interface DataBody<T> {
  data: T;
}
interface ErrorBody {
  error: { code: string; message: string };
}

const poll = async (id: string, until: (status: string) => boolean): Promise<string> => {
  for (let i = 0; i < 100; i++) {
    const res = await app.inject({ method: 'GET', url: `/agents/${id}` });
    const { status } = res.json<DataBody<{ status: string }>>().data;
    if (until(status)) return status;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out polling agent status');
};

describe('HTTP API (e2e)', () => {
  it('start → query → approve → completed', async () => {
    const started = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { topic: 'temporal vs cron' },
    });
    expect(started.statusCode).toBe(201);
    const { workflowId } = started.json<DataBody<{ workflowId: string }>>().data;

    expect(await poll(workflowId, (s) => s === 'awaiting_approval')).toBe('awaiting_approval');

    const approved = await app.inject({
      method: 'POST',
      url: `/agents/${workflowId}/approve`,
      payload: { approved: true },
    });
    expect(approved.statusCode).toBe(202);

    expect(await poll(workflowId, (s) => s === 'completed')).toBe('completed');

    const final = await app.inject({ method: 'GET', url: `/agents/${workflowId}` });
    expect(final.json<DataBody<{ finalAnswer?: string }>>().data.finalAnswer).toBeTruthy();
  });

  it('rejects an invalid start body with 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/agents', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json<ErrorBody>().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for an unknown workflow', async () => {
    const res = await app.inject({ method: 'GET', url: '/agents/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.json<ErrorBody>().error.code).toBe('NOT_FOUND');
  });

  it('healthz is ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
  });
});
