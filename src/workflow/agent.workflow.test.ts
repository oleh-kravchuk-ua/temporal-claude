import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker, bundleWorkflowCode, type WorkflowBundle } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AgentState, Plan, PlanStep } from './types';
import { agentWorkflow } from './agent.workflow';
import { approvePlan, cancelAgent, getState, provideGuidance } from './contracts';
import type { ApprovePlanInput } from './contracts';
import type { AiToolsActivities } from './ports';

const TASK_QUEUE = 'test';

let env: TestWorkflowEnvironment;
let bundle: WorkflowBundle;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
  bundle = await bundleWorkflowCode({
    workflowsPath: fileURLToPath(new URL('./agent.workflow.ts', import.meta.url)),
  });
}, 60_000);

afterAll(async () => {
  await env.teardown();
});

const plan = (topic: string): Plan => ({
  topic,
  steps: [
    { id: 1, description: 'research', tool: 'search' },
    { id: 2, description: 'summarize', tool: 'summarize' },
  ],
});

const mockActivities = (overrides: Partial<AiToolsActivities> = {}): AiToolsActivities => ({
  planTask: (topic: string): Promise<Plan> => Promise.resolve(plan(topic)),
  runTool: (step) => Promise.resolve({ stepId: step.id, output: `out-${step.id}` }),
  synthesize: (_topic, results) => Promise.resolve(`answer(${results.length})`),
  ...overrides,
});

/** Run `body` with a worker polling the test queue; the worker shuts down when `body` resolves. */
const withWorker = async (
  activities: AiToolsActivities,
  body: () => Promise<void>,
): Promise<void> => {
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowBundle: bundle,
    activities,
  });
  await worker.runUntil(body);
};

const startAgent = (topic = 'temporal vs cron') =>
  env.client.workflow.start(agentWorkflow, {
    taskQueue: TASK_QUEUE,
    workflowId: `agent-${randomUUID()}`,
    args: [{ topic }],
  });

type Handle = Awaited<ReturnType<typeof startAgent>>;

/** Poll the query until `predicate` holds (avoids racing signals ahead of the workflow). */
const waitFor = async (
  handle: Handle,
  predicate: (state: AgentState) => boolean,
): Promise<AgentState> => {
  for (let i = 0; i < 100; i++) {
    const state = await handle.query(getState);
    if (predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for workflow state');
};

const awaitingRevision = (revision: number) => (s: AgentState) =>
  s.status === 'awaiting_approval' && s.revision === revision;

describe('agentWorkflow', () => {
  it('happy path: approve → completed', async () => {
    await withWorker(mockActivities(), async () => {
      const handle = await startAgent();
      await waitFor(handle, awaitingRevision(1));
      await handle.signal(approvePlan, { approved: true });

      const result = await handle.result();
      expect(result.status).toBe('completed');
      expect(result.stepCount).toBe(2);
      expect(result.finalAnswer).toBe('answer(2)');
    });
  });

  it('reject with feedback re-plans (revision bump, feedback forwarded), then approves', async () => {
    const planTask = vi.fn((topic: string, _feedback?: string): Promise<Plan> =>
      Promise.resolve(plan(topic)),
    );
    await withWorker(mockActivities({ planTask }), async () => {
      const handle = await startAgent('workflows');
      await waitFor(handle, awaitingRevision(1));

      await handle.signal(approvePlan, { approved: false, feedback: 'go deeper' });
      await waitFor(handle, awaitingRevision(2));
      expect(planTask).toHaveBeenLastCalledWith('workflows', 'go deeper');

      await handle.signal(approvePlan, { approved: true });
      expect((await handle.result()).status).toBe('completed');
    });
  });

  it('ends as rejected after MAX_REJECTIONS', async () => {
    await withWorker(mockActivities(), async () => {
      const handle = await startAgent();
      await waitFor(handle, awaitingRevision(1));
      await handle.signal(approvePlan, { approved: false });
      await waitFor(handle, awaitingRevision(2));
      await handle.signal(approvePlan, { approved: false });
      await waitFor(handle, awaitingRevision(3));
      await handle.signal(approvePlan, { approved: false });

      expect((await handle.result()).status).toBe('rejected');
    });
  });

  it('cancel while awaiting approval → cancelled', async () => {
    await withWorker(mockActivities(), async () => {
      const handle = await startAgent();
      await waitFor(handle, awaitingRevision(1));
      await handle.signal(cancelAgent);

      expect((await handle.result()).status).toBe('cancelled');
    });
  });

  it('ignores a malformed approvePlan payload (still accepts a later valid one)', async () => {
    await withWorker(mockActivities(), async () => {
      const handle = await startAgent();
      await waitFor(handle, awaitingRevision(1));

      await handle.signal(approvePlan, { approved: 'yes' } as unknown as ApprovePlanInput);
      await handle.signal(approvePlan, { approved: true });

      const result = await handle.result();
      expect(result.status).toBe('completed');
      expect(result.revision).toBe(1); // the malformed signal did not trigger a re-plan
    });
  });

  it('ignores approvePlan signals received outside awaiting_approval', async () => {
    let releaseStep1: () => void = () => {};
    const step1Gate = new Promise<void>((resolve) => {
      releaseStep1 = resolve;
    });
    const runTool = vi.fn(async (step: PlanStep) => {
      if (step.id === 1) await step1Gate;
      return { stepId: step.id, output: `out-${step.id}` };
    });

    await withWorker(mockActivities({ runTool }), async () => {
      const handle = await startAgent();
      await waitFor(handle, awaitingRevision(1));
      await handle.signal(approvePlan, { approved: true });
      await waitFor(handle, (s) => s.status === 'executing' && s.currentStepId === 1);

      // a late signal while executing must be ignored, not restart/re-plan the run
      await handle.signal(approvePlan, { approved: false, feedback: 'too late' });
      releaseStep1();

      const result = await handle.result();
      expect(result.status).toBe('completed');
      expect(result.revision).toBe(1);
    });
  });

  it('ignores blank guidance', async () => {
    await withWorker(mockActivities(), async () => {
      const handle = await startAgent();
      await waitFor(handle, awaitingRevision(1));

      await handle.signal(provideGuidance, '   ');
      await handle.signal(approvePlan, { approved: true });
      await handle.result();

      expect((await handle.query(getState)).guidance).toEqual([]);
    });
  });

  it('cancel during execution stops before remaining steps run', async () => {
    let releaseStep1: () => void = () => {};
    const step1Gate = new Promise<void>((resolve) => {
      releaseStep1 = resolve;
    });
    const runTool = vi.fn(async (step: PlanStep) => {
      if (step.id === 1) await step1Gate;
      return { stepId: step.id, output: `out-${step.id}` };
    });

    await withWorker(mockActivities({ runTool }), async () => {
      const handle = await startAgent();
      await waitFor(handle, awaitingRevision(1));
      await handle.signal(approvePlan, { approved: true });
      await waitFor(handle, (s) => s.status === 'executing' && s.currentStepId === 1);

      await handle.signal(cancelAgent);
      releaseStep1();

      const result = await handle.result();
      expect(result.status).toBe('cancelled');
      expect(runTool).toHaveBeenCalledTimes(1); // step 2 never ran
    });
  });
});
