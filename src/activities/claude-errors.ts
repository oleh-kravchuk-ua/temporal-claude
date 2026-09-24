/**
 * Retry classification for the Claude-backed activities. Temporal owns retries (the SDK client
 * is built with `maxRetries: 0`), so each failure must say whether trying again can help:
 *
 * - transient (429, 5xx incl. 529 overloaded, 409, connection/timeout, anything unknown) →
 *   rethrown as-is, so the workflow's retry policy applies;
 * - permanent (400/401/403/404/422, refusals, truncated or empty output) → a non-retryable
 *   `ApplicationFailure`, because re-sending the same request would fail the same way.
 *
 * Failure messages are built here from status/category only. They never copy the upstream
 * message, which can echo request details.
 */

import {
  type APIError,
  BadRequestError,
  AuthenticationError,
  PermissionDeniedError,
  NotFoundError,
  UnprocessableEntityError,
} from '@anthropic-ai/sdk';
import type { Message } from '@anthropic-ai/sdk/resources/messages';
import { ApplicationFailure } from '@temporalio/activity';

const REQUEST_REJECTED = 'ClaudeRequestRejected';
const RESPONSE_UNUSABLE = 'ClaudeResponseUnusable';

const isPermanentApiError = (error: unknown): error is APIError =>
  error instanceof BadRequestError ||
  error instanceof AuthenticationError ||
  error instanceof PermissionDeniedError ||
  error instanceof NotFoundError ||
  error instanceof UnprocessableEntityError;

/** Use as `throw toActivityFailure(error)`: returns the error to throw, retryable or not. */
export const toActivityFailure = (error: unknown): unknown =>
  isPermanentApiError(error)
    ? ApplicationFailure.nonRetryable(
        `Claude API rejected the request (HTTP ${String(error.status)} ${error.constructor.name})`,
        REQUEST_REJECTED,
      )
    : error;

type UsableResponse = Pick<Message, 'stop_reason' | 'content' | 'stop_details'>;

export const unusableResponse = (message: string): ApplicationFailure =>
  ApplicationFailure.nonRetryable(message, RESPONSE_UNUSABLE);

/**
 * Returns the response text, or throws a non-retryable failure if the response is not a
 * complete answer (refusal, truncation, tool/pause stops, or no text).
 */
export const assertUsable = (response: UsableResponse): string => {
  const { stop_reason: stopReason } = response;

  if (stopReason === 'refusal') {
    const category = response.stop_details?.category ?? 'unspecified';
    throw unusableResponse(`Claude declined the request (refusal, category: ${category})`);
  }

  if (stopReason !== 'end_turn' && stopReason !== 'stop_sequence') {
    throw unusableResponse(`Claude response is not usable (stop_reason: ${String(stopReason)})`);
  }

  const text = response.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('');

  if (text.trim() === '') {
    throw unusableResponse('Claude response contained no text');
  }

  return text;
};
