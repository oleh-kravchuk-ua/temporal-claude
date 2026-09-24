/**
 * Strategy selection point: picks the concrete `AiToolsActivities` implementation the
 * worker registers — the offline mock by default, or the Claude-backed one when
 * `AI_PROVIDER=claude`. The worker keeps calling one factory without knowing which strategy
 * it got, and the workflow never finds out.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Logger } from 'pino';

import type { AppConfig } from '../infra/config';
import { ACTIVITY_START_TO_CLOSE_MS } from '../workflow/activity-timeout';
import type { AiToolsActivities } from '../workflow/ports';

import { createClaudeAiTools } from './claude-ai-tools';
import { createMockAiTools } from './mock-ai-tools';

/**
 * Must stay below the workflow's activity `startToCloseTimeout`. When that fires, Temporal fails
 * the attempt but does not abort the in-flight request, so without a shorter client timeout a
 * hung call would run on (SDK default: 10 minutes) while the retry starts. Hitting this limit
 * throws `APIConnectionTimeoutError`, which `claude-errors.ts` leaves retryable.
 */
export const CLAUDE_REQUEST_TIMEOUT_MS = ACTIVITY_START_TO_CLOSE_MS - 15_000;

/** `maxRetries: 0` — Temporal owns retries (see `claude-errors.ts`), so the SDK must not stack its own. */
export const createClaudeClient = (apiKey: string): Anthropic =>
  new Anthropic({ apiKey, maxRetries: 0, timeout: CLAUDE_REQUEST_TIMEOUT_MS });

/** `ai` is optional so callers that only want the mock (e.g. tests) need no config. */
export const createAiToolsActivities = (
  logger: Logger,
  ai?: AppConfig['ai'],
): AiToolsActivities => {
  if (ai?.provider !== 'claude') {
    return createMockAiTools(logger);
  }

  // `loadConfig` already enforces this; re-checked so this factory is safe on its own.
  if (ai.apiKey === undefined) {
    throw new Error('ANTHROPIC_API_KEY is required when AI_PROVIDER=claude');
  }

  return createClaudeAiTools(logger, createClaudeClient(ai.apiKey), { model: ai.model });
};
