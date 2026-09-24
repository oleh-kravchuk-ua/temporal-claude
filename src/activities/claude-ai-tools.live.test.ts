/**
 * Opt-in LIVE test against the real Claude API: skipped unless `ANTHROPIC_API_KEY` is set
 * (real env or `.env.local`), so `npm test` stays offline and free. Run it with:
 *
 *   npx vitest run src/activities/claude-ai-tools.live.test.ts
 *
 * It runs the same sequence the workflow does (plan → every step → synthesize) a few times,
 * prints per-activity latency, and checks each call fits the workflow's activity timeout.
 * It also confirms the request shape is accepted by the model (e.g. `thinking: disabled`).
 * Costs a few cents per run.
 */

import pino from 'pino';
import { describe, it, expect } from 'vitest';

import { loadConfig } from '../infra/config';
import { ACTIVITY_START_TO_CLOSE_MS } from '../workflow/activity-timeout';
import type { StepResult } from '../workflow/types';

import { createClaudeAiTools } from './claude-ai-tools';
import { createClaudeClient } from './index';

const RUNS = 3;
const TOPIC = 'How Temporal makes long-running workflows durable';

const { ai } = loadConfig();

type Activity = 'planTask' | 'runTool' | 'synthesize';

const percentile = (sorted: readonly number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;

describe.skipIf(ai.apiKey === undefined)('Claude live timing', () => {
  it(
    'completes plan → steps → synthesize within the activity timeout, and reports latency',
    async () => {
      const apiKey = ai.apiKey;
      if (apiKey === undefined) return;

      const activities = createClaudeAiTools(
        pino({ level: 'silent' }),
        createClaudeClient(apiKey),
        {
          model: ai.model,
        },
      );
      const timings: Record<Activity, number[]> = { planTask: [], runTool: [], synthesize: [] };

      const timed = async <T>(activity: Activity, fn: () => Promise<T>): Promise<T> => {
        const startedAt = performance.now();
        const result = await fn();
        timings[activity].push(Math.round(performance.now() - startedAt));
        return result;
      };

      const wholeRuns: number[] = [];
      for (let run = 0; run < RUNS; run += 1) {
        const runStartedAt = performance.now();

        const plan = await timed('planTask', () => activities.planTask(TOPIC));
        expect(plan.steps.length).toBeGreaterThan(0);

        const results: StepResult[] = [];
        for (const step of plan.steps) {
          results.push(await timed('runTool', () => activities.runTool(step, [])));
        }

        const answer = await timed('synthesize', () => activities.synthesize(TOPIC, results));
        expect(answer.length).toBeGreaterThan(0);

        wholeRuns.push(Math.round(performance.now() - runStartedAt));
      }

      const summary = Object.entries(timings).map(([activity, values]) => {
        const sorted = [...values].sort((a, b) => a - b);
        return {
          activity,
          calls: sorted.length,
          minMs: sorted[0],
          medianMs: percentile(sorted, 50),
          maxMs: sorted.at(-1),
        };
      });
      console.info(`\nModel: ${ai.model} — ${String(RUNS)} runs (plan → steps → synthesize)`);
      console.table(summary);
      console.info(`Whole-run wall time (ms): ${wholeRuns.join(', ')}`);

      const slowest = Math.max(...Object.values(timings).flat());
      console.info(
        `Slowest single call: ${String(slowest)} ms of the ${String(ACTIVITY_START_TO_CLOSE_MS)} ms activity timeout`,
      );
      expect(slowest).toBeLessThan(ACTIVITY_START_TO_CLOSE_MS);
    },
    RUNS * 5 * ACTIVITY_START_TO_CLOSE_MS,
  );
});
