import Anthropic from '@anthropic-ai/sdk';
import pino from 'pino';
import { beforeEach, describe, it, expect, vi } from 'vitest';

import { ACTIVITY_START_TO_CLOSE_MS } from '../workflow/activity-timeout';
import type { AiToolsActivities } from '../workflow/ports';

import { createAiToolsActivities, createClaudeClient } from './index';

const { claudeStub, createClaudeAiTools } = vi.hoisted(() => {
  const stub: AiToolsActivities = {
    planTask: vi.fn(),
    runTool: vi.fn(),
    synthesize: vi.fn(),
  };
  return {
    claudeStub: stub,
    createClaudeAiTools: vi.fn((_logger: unknown, _client: unknown, _options: unknown) => stub),
  };
});

vi.mock('./claude-ai-tools', () => ({ createClaudeAiTools }));

const logger = pino({ level: 'silent' });

describe('createAiToolsActivities', () => {
  beforeEach(() => {
    createClaudeAiTools.mockClear();
  });

  it('defaults to the mock strategy when no AI config is given', async () => {
    const activities = createAiToolsActivities(logger);

    const plan = await activities.planTask('durable execution');

    expect(plan.steps[0]?.description).toContain('durable execution');
    expect(createClaudeAiTools).not.toHaveBeenCalled();
  });

  it('uses the mock strategy for provider=mock, even if a key is present', async () => {
    const activities = createAiToolsActivities(logger, {
      provider: 'mock',
      model: 'claude-sonnet-5',
      apiKey: 'sk-test',
    });

    await activities.planTask('x');

    expect(createClaudeAiTools).not.toHaveBeenCalled();
  });

  it('builds the Claude strategy with the configured model for provider=claude', () => {
    const activities = createAiToolsActivities(logger, {
      provider: 'claude',
      model: 'claude-haiku-4-5',
      apiKey: 'sk-test',
    });

    const [call] = createClaudeAiTools.mock.calls;
    expect(activities).toBe(claudeStub);
    expect(call?.[0]).toBe(logger);
    expect(call?.[1]).toBeInstanceOf(Anthropic);
    expect(call?.[2]).toEqual({ model: 'claude-haiku-4-5' });
  });

  it('refuses to build the Claude strategy without a key', () => {
    expect(() =>
      createAiToolsActivities(logger, { provider: 'claude', model: 'claude-sonnet-5' }),
    ).toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe('createClaudeClient', () => {
  it('disables SDK retries so Temporal owns retrying', () => {
    expect(createClaudeClient('sk-test').maxRetries).toBe(0);
  });

  it('times out requests before the workflow activity timeout fires, with headroom', () => {
    const { timeout } = createClaudeClient('sk-test');

    expect(timeout).toBeGreaterThan(0);
    expect(timeout).toBeLessThanOrEqual(ACTIVITY_START_TO_CLOSE_MS - 10_000);
  });

  it('keeps the activity attempt limit at 1 minute', () => {
    expect(ACTIVITY_START_TO_CLOSE_MS).toBe(60_000);
  });

  it('uses the given key', () => {
    expect(createClaudeClient('sk-test').apiKey).toBe('sk-test');
  });
});
