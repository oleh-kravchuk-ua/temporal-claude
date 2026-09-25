import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { ApplicationFailure } from '@temporalio/activity';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker, bundleWorkflowCode, type WorkflowBundle } from '@temporalio/worker';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentState, Plan, PlanStep } from './types';
import { agentWorkflow } from './agent.workflow';
import { approvePlan, cancelAgent, getState, provideGuidance } from './contracts';
import type { ApprovePlanInput } from './contracts';
import type { AiToolsActivities } from './ports';

// A fresh queue per test: a run left over from an earlier test (say, one with a pending activity
// retry) must not be picked up by the next test's worker and call the wrong fake activities.
let taskQueue = 'test';

beforeEach(() => {
  taskQueue = `test-${randomUUID()}`;
});

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
    taskQueue,
    workflowBundle: bundle,
    activities,
  });
  await worker.runUntil(body);
};

const startAgent = (topic = 'temporal vs cron') =>
  env.client.workflow.start(agentWorkflow, {
    taskQueue,
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

  describe('activity failures', () => {
    /** The workflow still ends FAILED in Temporal; what matters is that the query says so too. */
    const failedState = async (handle: Handle): Promise<AgentState> => {
      await expect(handle.result()).rejects.toThrow();
      return handle.query(getState);
    };

    const permanent = (message: string): ApplicationFailure =>
      ApplicationFailure.nonRetryable(message, 'TestPermanent');

    it('planTask failing permanently → state says failed, with a safe error (no retries)', async () => {
      const planTask = vi.fn((): Promise<Plan> =>
        Promise.reject(permanent('Claude API rejected the request (HTTP 401)')),
      );

      await withWorker(mockActivities({ planTask }), async () => {
        const state = await failedState(await startAgent());

        expect(state.status).toBe('failed');
        expect(state.error).toBe('Claude API rejected the request (HTTP 401)');
        expect(state.revision).toBe(1);
        expect(planTask).toHaveBeenCalledTimes(1);
      });
    });

    it('runTool failing on step 2 keeps the finished work and the failing step', async () => {
      const runTool = vi.fn((step: PlanStep) =>
        step.id === 2
          ? Promise.reject(permanent('step 2 refused'))
          : Promise.resolve({ stepId: step.id, output: `out-${step.id}` }),
      );

      await withWorker(mockActivities({ runTool }), async () => {
        const handle = await startAgent();
        await waitFor(handle, awaitingRevision(1));
        await handle.signal(approvePlan, { approved: true });

        const state = await failedState(handle);

        expect(state.status).toBe('failed');
        expect(state.error).toBe('step 2 refused');
        expect(state.currentStepId).toBe(2);
        expect(state.results).toHaveLength(1);
        expect(state.finalAnswer).toBeUndefined();
      });
    });

    it('synthesize failing keeps all step results', async () => {
      const synthesize = vi.fn(() => Promise.reject(permanent('synthesis refused')));

      await withWorker(mockActivities({ synthesize }), async () => {
        const handle = await startAgent();
        await waitFor(handle, awaitingRevision(1));
        await handle.signal(approvePlan, { approved: true });

        const state = await failedState(handle);

        expect(state.status).toBe('failed');
        expect(state.error).toBe('synthesis refused');
        expect(state.results).toHaveLength(2);
      });
    });

    it('retryable failures exhaust the attempts; the raw message never reaches state.error', async () => {
      const planTask = vi.fn((): Promise<Plan> =>
        Promise.reject(new Error('upstream 429 body with req_123 and org details')),
      );

      await withWorker(mockActivities({ planTask }), async () => {
        const state = await failedState(await startAgent());

        expect(state.status).toBe('failed');
        expect(planTask).toHaveBeenCalledTimes(4);
        expect(state.error).toBe('Activity "planTask" failed (MAXIMUM_ATTEMPTS_REACHED)');
        expect(state.error).not.toContain('req_123');
        expect(state.error).not.toContain('org details');
      });
    });
  });
  describe('retry policy', () => {
    it('recovers when a transient failure clears within the attempts (3 failures, 4th succeeds)', async () => {
      let calls = 0;
      const planTask = vi.fn((topic: string): Promise<Plan> => {
        calls += 1;
        return calls < 4 ? Promise.reject(new Error('transient')) : Promise.resolve(plan(topic));
      });

      await withWorker(mockActivities({ planTask }), async () => {
        const handle = await startAgent();
        // The retry waits (2 s + 4 s + 8 s) are virtual time; polling alone would never see them pass.
        await env.sleep('30s');
        await waitFor(handle, awaitingRevision(1));

        expect(planTask).toHaveBeenCalledTimes(4);
      });
    });

    it("waits the failure's own nextRetryDelay before the next attempt", async () => {
      let calls = 0;
      const planTask = vi.fn((topic: string): Promise<Plan> => {
        calls += 1;
        return calls === 1
          ? Promise.reject(
              ApplicationFailure.create({ message: 'slow down', nextRetryDelay: '40s' }),
            )
          : Promise.resolve(plan(topic));
      });

      await withWorker(mockActivities({ planTask }), async () => {
        const handle = await startAgent();
        // Let the first attempt run and fail, then advance the virtual clock past the delay.
        await env.sleep('2s');
        expect(planTask).toHaveBeenCalledTimes(1);
        await env.sleep('60s');
        await waitFor(handle, awaitingRevision(1));

        // Read the delay the server actually applied from the history timestamps: attempt 1 was
        // scheduled at t0, attempt 2 started after the wait (a plain backoff would be ~2 s).
        const events = (await handle.fetchHistory()).events ?? [];
        const seconds = (
          kind: 'activityTaskScheduledEventAttributes' | 'activityTaskStartedEventAttributes',
        ): number => Number(events.find((event) => event[kind])?.eventTime?.seconds ?? 0);
        const applied =
          seconds('activityTaskStartedEventAttributes') -
          seconds('activityTaskScheduledEventAttributes');

        expect(planTask).toHaveBeenCalledTimes(2);
        expect(applied).toBeGreaterThanOrEqual(40);
      });
    });
  });
});
