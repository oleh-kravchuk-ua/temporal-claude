import { InternalServerError, RateLimitError, BadRequestError } from '@anthropic-ai/sdk';
import type { MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages';
import { ApplicationFailure } from '@temporalio/activity';
import pino from 'pino';
import { describe, it, expect, vi } from 'vitest';

import type { PlanStep, StepResult } from '../workflow/types';

import { createClaudeAiTools, type ClaudeClient, type ClaudeResponse } from './claude-ai-tools';
import { PLANNER_SYSTEM, STEP_SYSTEM, SYNTHESIS_SYSTEM } from './claude-prompts';

const MODEL = 'claude-sonnet-5';
const headers = new Headers();

const reply = (text: string, overrides: Partial<ClaudeResponse> = {}): ClaudeResponse => ({
  stop_reason: 'end_turn',
  stop_details: null,
  content: [{ type: 'text', text, citations: null }],
  usage: { input_tokens: 10, output_tokens: 20 },
  ...overrides,
});

interface Fake {
  readonly client: ClaudeClient;
  readonly create: ReturnType<
    typeof vi.fn<(params: MessageCreateParamsNonStreaming) => Promise<ClaudeResponse>>
  >;
  /** The request of the first call. */
  readonly request: () => MessageCreateParamsNonStreaming;
}

const fakeClient = (respond: () => Promise<ClaudeResponse>): Fake => {
  const create = vi.fn<(params: MessageCreateParamsNonStreaming) => Promise<ClaudeResponse>>(() =>
    respond(),
  );
  const request = (): MessageCreateParamsNonStreaming => {
    const first = create.mock.calls[0];
    if (!first) throw new Error('client.messages.create was not called');
    return first[0];
  };
  return { client: { messages: { create } }, create, request };
};

const replying = (text: string, overrides?: Partial<ClaudeResponse>): Fake =>
  fakeClient(() => Promise.resolve(reply(text, overrides)));

const failing = (error: Error): Fake => fakeClient(() => Promise.reject(error));

const userText = (request: MessageCreateParamsNonStreaming): string => {
  const [message] = request.messages;
  return typeof message?.content === 'string' ? message.content : '';
};

const silent = pino({ level: 'silent' });
const tools = (fake: Fake): ReturnType<typeof createClaudeAiTools> =>
  createClaudeAiTools(silent, fake.client, { model: MODEL });

const planJson = (
  steps: ReadonlyArray<{ tool: string; description: string }> = [
    { tool: 'search', description: 'Research sources' },
    { tool: 'summarize', description: 'Summarize findings' },
    { tool: 'draft', description: 'Draft the answer' },
  ],
): string => JSON.stringify({ steps });

/** Runs `fn` and returns the thrown value, so assertions can inspect it. */
const thrown = async (fn: () => Promise<unknown>): Promise<unknown> => {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  return expect.unreachable('expected the call to throw');
};

const expectNonRetryable = (error: unknown): void => {
  expect(error).toBeInstanceOf(ApplicationFailure);
  expect((error as ApplicationFailure).nonRetryable).toBe(true);
};

describe('planTask', () => {
  it('returns a plan with 1-based ids from the model output', async () => {
    const fake = replying(planJson());

    const plan = await tools(fake).planTask('  temporal vs cron ');

    expect(plan.topic).toBe('temporal vs cron');
    expect(plan.steps).toEqual([
      { id: 1, tool: 'search', description: 'Research sources' },
      { id: 2, tool: 'summarize', description: 'Summarize findings' },
      { id: 3, tool: 'draft', description: 'Draft the answer' },
    ]);
  });

  it('sends a well-formed request: constant system, one user turn, structured output', async () => {
    const fake = replying(planJson());

    await tools(fake).planTask('temporal vs cron');
    const request = fake.request();

    expect(request.model).toBe(MODEL);
    expect(request.max_tokens).toBe(2048);
    expect(request.system).toBe(PLANNER_SYSTEM);
    expect(request.thinking).toEqual({ type: 'disabled' });
    expect(request.output_config?.format?.type).toBe('json_schema');
    expect(request.messages).toHaveLength(1);
    expect(request.messages[0]?.role).toBe('user');
    expect(userText(request)).toContain('<topic>temporal vs cron</topic>');
  });

  it('never sends parameters that claude-sonnet-5 rejects', async () => {
    const fake = replying(planJson());

    await tools(fake).planTask('t');
    const request = fake.request();

    for (const forbidden of ['temperature', 'top_p', 'top_k']) {
      expect(request).not.toHaveProperty(forbidden);
    }
    expect(JSON.stringify(request)).not.toContain('budget_tokens');
    // no assistant prefill: the last message is the user turn
    expect(request.messages.at(-1)?.role).toBe('user');
  });

  it('passes feedback to the model when re-planning', async () => {
    const fake = replying(planJson());

    await tools(fake).planTask('durable execution', 'go deeper on retries');

    expect(userText(fake.request())).toContain('<feedback>go deeper on retries</feedback>');
  });

  it('does not mention feedback on the first plan', async () => {
    const fake = replying(planJson());

    await tools(fake).planTask('durable execution');

    expect(userText(fake.request())).not.toContain('feedback');
  });

  it.each([
    ['not JSON', 'here is your plan: 1) search'],
    ['a JSON value of the wrong shape', '{"plan": []}'],
    ['zero steps', planJson([])],
    ['an unknown tool', planJson([{ tool: 'browse', description: 'x' }])],
    [
      'too many steps',
      planJson(Array.from({ length: 9 }, () => ({ tool: 'draft', description: 'x' }))),
    ],
    ['a blank description', planJson([{ tool: 'draft', description: '  ' }])],
  ])('fails non-retryably when the model returns %s', async (_name, text) => {
    const fake = replying(text);

    expectNonRetryable(await thrown(() => tools(fake).planTask('t')));
  });

  it('fails non-retryably on a refusal, naming the category', async () => {
    const fake = replying('', {
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'cyber', explanation: null },
    });

    const error = await thrown(() => tools(fake).planTask('t'));

    expectNonRetryable(error);
    expect((error as ApplicationFailure).message).toContain('cyber');
  });

  it('fails non-retryably when the output was truncated', async () => {
    const fake = replying('{"steps":[', { stop_reason: 'max_tokens' });

    expectNonRetryable(await thrown(() => tools(fake).planTask('t')));
  });

  it('leaves transient API errors retryable (rethrown as-is)', async () => {
    for (const error of [
      new RateLimitError(429, {}, 'slow down', headers),
      new InternalServerError(529, {}, 'overloaded', headers),
    ]) {
      expect(await thrown(() => tools(failing(error)).planTask('t'))).toBe(error);
    }
  });

  it('makes permanent API errors non-retryable', async () => {
    const fake = failing(new BadRequestError(400, {}, 'bad', headers));

    expectNonRetryable(await thrown(() => tools(fake).planTask('t')));
  });

  it('logs the duration of each Claude call, on success and on failure', async () => {
    const lines: string[] = [];
    const logger = pino({ level: 'debug' }, { write: (line: string) => void lines.push(line) });
    const entries = (): Array<Record<string, unknown>> =>
      lines.map((line) => JSON.parse(line) as Record<string, unknown>);

    await createClaudeAiTools(logger, replying(planJson()).client, { model: MODEL }).planTask('t');
    const ok = entries().find((entry) => entry['msg'] === 'claude response');
    expect(ok).toMatchObject({ activity: 'planTask', stopReason: 'end_turn' });
    expect(typeof ok?.['durationMs']).toBe('number');

    lines.length = 0;
    const failure = failing(new RateLimitError(429, {}, 'slow down', headers));
    await thrown(() => createClaudeAiTools(logger, failure.client, { model: MODEL }).planTask('t'));
    const failed = entries().find((entry) => entry['msg'] === 'claude request failed');
    expect(failed).toMatchObject({ activity: 'planTask', errorType: 'RateLimitError' });
    expect(typeof failed?.['durationMs']).toBe('number');
    expect(lines.join('')).not.toContain('slow down');
  });

  it('does not log the completion text', async () => {
    const lines: string[] = [];
    const logger = pino({ level: 'debug' }, { write: (line: string) => void lines.push(line) });
    const fake = replying(planJson([{ tool: 'draft', description: 'SECRET-COMPLETION-TEXT' }]));

    await createClaudeAiTools(logger, fake.client, { model: MODEL }).planTask('t');

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('')).not.toContain('SECRET-COMPLETION-TEXT');
  });
});

const step: PlanStep = { id: 2, tool: 'summarize', description: 'Summarize key findings' };

describe('runTool', () => {
  it('returns the step id and the model text as the output', async () => {
    const fake = replying('  Key findings: A, B.  ');

    const result = await tools(fake).runTool(step, []);

    expect(result).toEqual({ stepId: 2, output: 'Key findings: A, B.' });
  });

  it('sends the step system prompt, the step, and low effort with a small token budget', async () => {
    const fake = replying('ok');

    await tools(fake).runTool(step, []);
    const request = fake.request();

    expect(request.model).toBe(MODEL);
    expect(request.system).toBe(STEP_SYSTEM);
    expect(request.max_tokens).toBe(2048);
    expect(request.thinking).toEqual({ type: 'disabled' });
    expect(request.output_config?.effort).toBe('low');
    expect(request.output_config?.format).toBeUndefined();
    expect(userText(request)).toContain('<tool>summarize</tool>');
    expect(userText(request)).toContain('<step>Summarize key findings</step>');
    expect(userText(request)).not.toContain('guidance');
  });

  it('applies every guidance item', async () => {
    const fake = replying('ok');

    await tools(fake).runTool(step, ['prefer recent sources', 'be concise']);

    expect(userText(fake.request())).toContain('prefer recent sources');
    expect(userText(fake.request())).toContain('be concise');
  });

  it('never sends parameters that claude-sonnet-5 rejects', async () => {
    const fake = replying('ok');

    await tools(fake).runTool(step, []);

    for (const forbidden of ['temperature', 'top_p', 'top_k']) {
      expect(fake.request()).not.toHaveProperty(forbidden);
    }
  });

  it('fails non-retryably on empty text, refusal and truncation', async () => {
    for (const fake of [
      replying('   '),
      replying('', { stop_reason: 'refusal' }),
      replying('partial', { stop_reason: 'max_tokens' }),
    ]) {
      expectNonRetryable(await thrown(() => tools(fake).runTool(step, [])));
    }
  });

  it('leaves transient errors retryable and permanent errors non-retryable', async () => {
    const transient = new RateLimitError(429, {}, 'slow', headers);
    expect(await thrown(() => tools(failing(transient)).runTool(step, []))).toBe(transient);

    const permanent = failing(new BadRequestError(400, {}, 'bad', headers));
    expectNonRetryable(await thrown(() => tools(permanent).runTool(step, [])));
  });
});

describe('synthesize', () => {
  const results: StepResult[] = [
    { stepId: 1, output: 'first output' },
    { stepId: 2, output: 'second output' },
  ];

  it('returns the trimmed model text as the final answer', async () => {
    const fake = replying('\nFinal answer.\n');

    expect(await tools(fake).synthesize('durable execution', results)).toBe('Final answer.');
  });

  it('sends the synthesis system prompt with the topic and all outputs in order', async () => {
    const fake = replying('ok');

    await tools(fake).synthesize('durable execution', results);
    const request = fake.request();
    const prompt = userText(request);

    expect(request.system).toBe(SYNTHESIS_SYSTEM);
    expect(request.max_tokens).toBe(4096);
    expect(request.thinking).toEqual({ type: 'disabled' });
    expect(request.output_config?.format).toBeUndefined();
    expect(prompt).toContain('<topic>durable execution</topic>');
    expect(prompt.indexOf('first output')).toBeGreaterThan(-1);
    expect(prompt.indexOf('first output')).toBeLessThan(prompt.indexOf('second output'));
  });

  it('fails non-retryably on empty text, refusal and truncation', async () => {
    for (const fake of [
      replying(''),
      replying('', { stop_reason: 'refusal' }),
      replying('partial', { stop_reason: 'max_tokens' }),
    ]) {
      expectNonRetryable(await thrown(() => tools(fake).synthesize('t', results)));
    }
  });

  it('leaves transient errors retryable', async () => {
    const transient = new InternalServerError(500, {}, 'oops', headers);

    expect(await thrown(() => tools(failing(transient)).synthesize('t', results))).toBe(transient);
  });
});
