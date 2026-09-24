/**
 * Direct (non-sandboxed) unit tests for the narrow slice of `AgentRun` that doesn't touch
 * `@temporalio/workflow`'s `log`/`condition` on any reachable path. Both throw synchronously
 * (`IllegalStateError` via `assertInWorkflowContext`) unless called from inside a real Temporal
 * workflow execution — confirmed by reading the SDK source
 * (`node_modules/@temporalio/workflow/lib/global-attributes.js`), not assumed.
 *
 * That rules out almost everything else here: `execute`/`planUntilApproved`/`runSteps`/
 * `synthesizeAnswer`/`finish` all call `log.*` or `condition()` on every path, and `approve()`
 * always hits its `log.warn` "wrong status" guard on a freshly constructed instance (`status`
 * starts at `'planning'` and nothing outside `execute()` can move it to `'awaiting_approval'`).
 * That behavior — the full state machine — is covered instead by
 * `agent.workflow.test.ts`, which runs `AgentRun` for real inside `TestWorkflowEnvironment`.
 */

import { describe, expect, it } from 'vitest';

import { AgentRun } from './agent-run';

describe('AgentRun (direct, non-sandboxed)', () => {
  it('starts with a clean initial snapshot', () => {
    const run = new AgentRun('temporal vs cron');

    expect(run.snapshot()).toEqual({
      status: 'planning',
      topic: 'temporal vs cron',
      revision: 0,
      results: [],
      guidance: [],
    });
  });

  it('addGuidance appends valid, non-empty guidance', () => {
    const run = new AgentRun('temporal vs cron');

    run.addGuidance('prefer recent sources');
    run.addGuidance('  keep it concise  ');

    expect(run.snapshot().guidance).toEqual(['prefer recent sources', 'keep it concise']);
  });

  it('cancel stays context-free (regression guard: no log call was added to it)', () => {
    const run = new AgentRun('temporal vs cron');

    // If `cancel()` ever starts calling `log`/`condition`, this throws — that's the point.
    expect(() => run.cancel()).not.toThrow();
  });
});
