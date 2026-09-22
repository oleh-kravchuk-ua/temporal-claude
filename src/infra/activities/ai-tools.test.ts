import { pino } from 'pino';
import { describe, it, expect } from 'vitest';

import type { PlanStep } from '../../domain';
import { createAiToolsActivities } from './ai-tools';

const { planTask, runTool, synthesize } = createAiToolsActivities(pino({ level: 'silent' }));

describe('planTask', () => {
  it('produces a non-empty plan with sequential 1-based step ids', async () => {
    const plan = await planTask('Temporal vs cron');
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.steps.map((s) => s.id)).toEqual(plan.steps.map((_s, i) => i + 1));
  });

  it('trims the topic', async () => {
    expect((await planTask('  durable execution  ')).topic).toBe('durable execution');
  });

  it('uses the default search → summarize → draft outline without feedback', async () => {
    const plan = await planTask('workflows');
    expect(plan.steps.map((s) => s.tool)).toEqual(['search', 'summarize', 'draft']);
  });

  it('prepends a re-research step that echoes reviewer feedback', async () => {
    const plan = await planTask('workflows', 'go deeper on retries');
    expect(plan.steps).toHaveLength(4);
    expect(plan.steps[0]?.tool).toBe('search');
    expect(plan.steps[0]?.description).toContain('go deeper on retries');
  });

  it('ignores blank feedback', async () => {
    expect((await planTask('workflows', '   ')).steps).toHaveLength(3);
  });

  it('is deterministic', async () => {
    expect(await planTask('x', 'y')).toEqual(await planTask('x', 'y'));
  });
});

describe('runTool', () => {
  const step: PlanStep = { id: 2, description: 'Summarize findings', tool: 'summarize' };

  it('preserves the step id and reflects the tool and description', async () => {
    const result = await runTool(step, []);
    expect(result.stepId).toBe(2);
    expect(result.output).toContain('[summarize]');
    expect(result.output).toContain('Summarize findings');
  });

  it('folds in guidance when present and omits it when empty', async () => {
    expect((await runTool(step, ['prefer recent sources'])).output).toContain(
      'guidance: prefer recent sources',
    );
    expect((await runTool(step, [])).output).not.toContain('guidance:');
  });
});

describe('synthesize', () => {
  it('includes the topic and one bullet per result', async () => {
    const answer = await synthesize('topic', [
      { stepId: 1, output: 'a' },
      { stepId: 2, output: 'b' },
    ]);
    expect(answer).toContain('topic');
    expect(answer).toContain('- a');
    expect(answer).toContain('- b');
  });

  it('handles an empty result set', async () => {
    expect(await synthesize('topic', [])).toContain('topic');
  });
});
