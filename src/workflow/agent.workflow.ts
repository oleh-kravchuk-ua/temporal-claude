/**
 * Application: the human-in-the-loop agent workflow (orchestration only).
 *
 * Run state is encapsulated in the `AgentRun` class (created fresh per execution, so it stays
 * deterministic). The exported workflow just wires signals/queries to the instance and runs
 * its pipeline. Depends on the `AiToolsActivities` port (never on infra); all non-determinism
 * lives in activities; signal handlers are non-async and only mutate local state.
 *
 * State machine (see CLAUDE.md, Workflow rules): plan → await approval → (reject → re-plan, up to MAX_REJECTIONS) →
 * execute steps → synthesize → complete. A `cancel` signal ends the run from any wait point.
 */

import { setHandler, proxyActivities } from '@temporalio/workflow';

import {
  AgentInputSchema,
  approvePlan,
  cancelAgent,
  getState,
  provideGuidance,
  type AgentInput,
  type AgentResult,
} from './contracts';

import { ACTIVITY_RETRY, ACTIVITY_START_TO_CLOSE_MS } from './activity-timeout';
import { AgentRun } from './agent-run';

import type { AiToolsActivities } from './ports';

const activities = proxyActivities<AiToolsActivities>({
  startToCloseTimeout: ACTIVITY_START_TO_CLOSE_MS,
  retry: ACTIVITY_RETRY,
});

export const agentWorkflow = async (input: AgentInput): Promise<AgentResult> => {
  const { topic } = AgentInputSchema.parse(input);
  const run = new AgentRun(topic);

  setHandler(getState, () => run.snapshot());
  setHandler(approvePlan, (raw) => {
    run.approve(raw);
  });
  setHandler(provideGuidance, (raw) => {
    run.addGuidance(raw);
  });
  setHandler(cancelAgent, () => {
    run.cancel();
  });

  return run.execute(activities);
};
