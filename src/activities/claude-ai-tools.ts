/**
 * Claude-backed `AiToolsActivities` strategy (the real sibling of `mock-ai-tools.ts`).
 *
 * The SDK client and the logger are injected, so unit tests pass a fake and never touch the
 * network. The real client is built in `activities/index.ts` with `maxRetries: 0`: Temporal
 * owns retries, and `claude-errors.ts` says which failures are worth retrying.
 *
 * Only `thinking: { type: 'disabled' }` is sent for reasoning control, and no sampling
 * parameters: `claude-sonnet-5` rejects those with a 400.
 */

import type {
  Message,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/messages';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { Logger } from 'pino';

import type { AiToolsActivities } from '../workflow/ports';

import { assertUsable, toActivityFailure, unusableResponse } from './claude-errors';
import {
  PLANNER_SYSTEM,
  STEP_SYSTEM,
  SYNTHESIS_SYSTEM,
  PlanOutputSchema,
  buildPlanPrompt,
  buildStepPrompt,
  buildSynthesisPrompt,
  toPlan,
  type PlanOutput,
} from './claude-prompts';

/** The slice of the response the adapter reads (a real `Message` satisfies it). */
export type ClaudeResponse = Pick<Message, 'content' | 'stop_reason' | 'stop_details'> & {
  readonly usage: Pick<Message['usage'], 'input_tokens' | 'output_tokens'>;
};

/** The slice of the SDK client the adapter uses (a real `Anthropic` satisfies it). */
export interface ClaudeClient {
  readonly messages: {
    readonly create: (params: MessageCreateParamsNonStreaming) => PromiseLike<ClaudeResponse>;
  };
}

export interface ClaudeOptions {
  readonly model: string;
}

const PLAN_MAX_TOKENS = 2048;
/** Output cap for one step; see `STEP_MAX_WORDS` for the budget that keeps answers well below it. */
export const STEP_MAX_TOKENS = 2048;
const SYNTHESIS_MAX_TOKENS = 4096;

const planFormat = zodOutputFormat(PlanOutputSchema);

const parsePlanOutput = (text: string): PlanOutput => {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw unusableResponse('Claude plan was not valid JSON');
  }

  const parsed = PlanOutputSchema.safeParse(json);
  if (!parsed.success) {
    throw unusableResponse(
      `Claude plan failed validation (${String(parsed.error.issues.length)} issue(s))`,
    );
  }
  return parsed.data;
};

export const createClaudeAiTools = (
  logger: Logger,
  client: ClaudeClient,
  { model }: ClaudeOptions,
): AiToolsActivities => {
  const ask = async (
    activity: string,
    request: Pick<MessageCreateParamsNonStreaming, 'system' | 'max_tokens' | 'output_config'> & {
      readonly prompt: string;
    },
  ): Promise<string> => {
    const { prompt, ...rest } = request;
    const startedAt = performance.now();
    const elapsedMs = (): number => Math.round(performance.now() - startedAt);

    let response: ClaudeResponse;
    try {
      response = await client.messages.create({
        model,
        ...rest,
        thinking: { type: 'disabled' },
        messages: [{ role: 'user', content: prompt }],
      });
    } catch (error) {
      // Type and timing only: the SDK message can echo request details.
      logger.warn(
        {
          activity,
          errorType: error instanceof Error ? error.constructor.name : typeof error,
          durationMs: elapsedMs(),
        },
        'claude request failed',
      );
      throw toActivityFailure(error);
    }

    logger.debug(
      {
        activity,
        stopReason: response.stop_reason,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        durationMs: elapsedMs(),
      },
      'claude response',
    );
    return assertUsable(response);
  };

  return {
    planTask: async (topic, feedback) => {
      logger.debug({ topic, hasFeedback: feedback !== undefined }, 'planTask');
      const text = await ask('planTask', {
        system: PLANNER_SYSTEM,
        max_tokens: PLAN_MAX_TOKENS,
        output_config: { format: planFormat },
        prompt: buildPlanPrompt(topic, feedback),
      });
      return toPlan(topic, parsePlanOutput(text));
    },

    runTool: async (step, guidance) => {
      logger.debug({ stepId: step.id, tool: step.tool }, 'runTool');
      const output = await ask('runTool', {
        system: STEP_SYSTEM,
        max_tokens: STEP_MAX_TOKENS,
        output_config: { effort: 'low' },
        prompt: buildStepPrompt(step, guidance),
      });
      return { stepId: step.id, output: output.trim() };
    },

    synthesize: async (topic, results) => {
      logger.debug({ topic, steps: results.length }, 'synthesize');
      const answer = await ask('synthesize', {
        system: SYNTHESIS_SYSTEM,
        max_tokens: SYNTHESIS_MAX_TOKENS,
        prompt: buildSynthesisPrompt(topic, results),
      });
      return answer.trim();
    },
  };
};
