/**
 * Diagnostics tool (not a workflow client): checks that the Claude connection works and runs a
 * short latency benchmark. Talks to the real API, so it costs a few cents.
 *
 *   npm run claude:check [-- --runs 3]
 *
 * 1. Connection check — one tiny raw SDK call; prints status and time, or the API's error.
 * 2. Benchmark — the real Claude adapter (plan → first step → synthesize) N times. Each call is
 *    timed twice: by the adapter itself (its logged `durationMs`, request only) and here by wall
 *    clock (including validation), so any overhead outside the request shows up.
 *
 * Reads ANTHROPIC_API_KEY through `infra/config` and never prints it.
 */

import { APIError } from '@anthropic-ai/sdk';
import pino from 'pino';

import { createClaudeClient } from '../activities';
import { createClaudeAiTools } from '../activities/claude-ai-tools';
import { loadConfig } from '../infra/config';
import { ACTIVITY_START_TO_CLOSE_MS } from '../workflow/activity-timeout';

import { summarize } from './latency-stats';

const TOPIC = 'How Temporal makes long-running workflows durable';
const DEFAULT_RUNS = 3;

const parseRuns = (argv: readonly string[]): number => {
  const index = argv.indexOf('--runs');
  const value = index === -1 ? undefined : Number(argv[index + 1]);
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : DEFAULT_RUNS;
};

const describeError = (error: unknown): string =>
  error instanceof APIError
    ? `${error.constructor.name} (HTTP ${String(error.status)}): ${error.message}`
    : error instanceof Error
      ? `${error.constructor.name}: ${error.message}`
      : String(error);

type Activity = 'planTask' | 'runTool' | 'synthesize';

const run = async (): Promise<void> => {
  const { ai } = loadConfig();
  if (ai.apiKey === undefined) {
    throw new Error('ANTHROPIC_API_KEY is not set (put it in .env.local or the environment)');
  }

  const client = createClaudeClient(ai.apiKey);
  console.info(`Model: ${ai.model}`);

  // 1. Connection check: a raw SDK call, no adapter involved.
  const checkStartedAt = performance.now();
  try {
    const reply = await client.messages.create({
      model: ai.model,
      max_tokens: 16,
      thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
    });
    const ms = Math.round(performance.now() - checkStartedAt);
    console.info(
      `Connection check: OK in ${String(ms)} ms (stop_reason=${String(reply.stop_reason)}, output_tokens=${String(reply.usage.output_tokens)})`,
    );
  } catch (error) {
    const ms = Math.round(performance.now() - checkStartedAt);
    console.error(`Connection check: FAILED after ${String(ms)} ms — ${describeError(error)}`);
    process.exitCode = 1;
    return;
  }

  // 2. Benchmark through the real adapter. Its own per-call `durationMs` is captured from logs.
  const adapterMs: Record<Activity, number[]> = { planTask: [], runTool: [], synthesize: [] };
  const wallMs: Record<Activity, number[]> = { planTask: [], runTool: [], synthesize: [] };
  const outputTokens: Record<Activity, number[]> = { planTask: [], runTool: [], synthesize: [] };
  let current: Activity = 'planTask';

  const logger = pino(
    { level: 'debug' },
    {
      write: (line: string) => {
        const entry = JSON.parse(line) as {
          msg?: string;
          durationMs?: number;
          outputTokens?: number;
        };
        if (entry.msg === 'claude response' && typeof entry.durationMs === 'number') {
          adapterMs[current].push(entry.durationMs);
          outputTokens[current].push(entry.outputTokens ?? 0);
        }
      },
    },
  );
  const activities = createClaudeAiTools(logger, client, { model: ai.model });

  const timed = async <T>(activity: Activity, fn: () => Promise<T>): Promise<T> => {
    current = activity;
    const startedAt = performance.now();
    const result = await fn();
    const ms = Math.round(performance.now() - startedAt);
    wallMs[activity].push(ms);
    console.info(`  ${activity.padEnd(10)} ${String(ms).padStart(6)} ms`);
    return result;
  };

  const runs = parseRuns(process.argv);
  console.info(`\nBenchmark: ${String(runs)} run(s) of plan → first step → synthesize`);
  for (let index = 1; index <= runs; index += 1) {
    console.info(`run ${String(index)}`);
    const plan = await timed('planTask', () => activities.planTask(TOPIC));
    const [step] = plan.steps;
    if (step === undefined) throw new Error('The plan had no steps');
    const result = await timed('runTool', () => activities.runTool(step, []));
    await timed('synthesize', () => activities.synthesize(TOPIC, [result]));
  }

  console.info(
    '\nLatency (ms). "request" = measured inside the adapter; "wall" = incl. validation.',
  );
  console.table(
    (Object.keys(wallMs) as Activity[]).map((activity) => {
      const request = summarize(adapterMs[activity]);
      const wall = summarize(wallMs[activity]);
      return {
        activity,
        calls: wall.calls,
        requestMin: request.minMs,
        requestMedian: request.medianMs,
        requestMax: request.maxMs,
        wallMedian: wall.medianMs,
        wallMax: wall.maxMs,
        maxOutputTokens: summarize(outputTokens[activity]).maxMs,
      };
    }),
  );

  const slowest = Math.max(...Object.values(wallMs).flat());
  console.info(
    `Slowest call: ${String(slowest)} ms — activity limit ${String(ACTIVITY_START_TO_CLOSE_MS)} ms (${String(Math.round((slowest / ACTIVITY_START_TO_CLOSE_MS) * 100))}% used)`,
  );
};

run().catch((error: unknown) => {
  console.error(`claude:check failed: ${describeError(error)}`);
  process.exitCode = 1;
});
