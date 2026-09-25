/**
 * Retry classification for the Claude-backed activities. Temporal owns retries (the SDK client
 * is built with `maxRetries: 0`), so each failure must say whether trying again can help:
 *
 * - transient API errors (429, 5xx incl. 529 overloaded, 409) → a retryable `ApplicationFailure`
 *   with a sanitized message and, when the server sent `retry-after`, that as its next retry delay
 *   (so a rate limit is waited out instead of burning attempts in seconds);
 * - connection errors, timeouts and anything unknown → rethrown as-is, so the workflow's retry
 *   policy applies;
 * - permanent (400/401/403/404/422, refusals, truncated or empty output) → a non-retryable
 *   `ApplicationFailure`, because re-sending the same request would fail the same way.
 *
 * Failure messages are built here from status/category only. They never copy the upstream
 * message, which can echo request details.
 */

import {
  APIError,
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
const TRANSIENT = 'ClaudeTransient';

const isPermanentApiError = (error: unknown): error is APIError =>
  error instanceof BadRequestError ||
  error instanceof AuthenticationError ||
  error instanceof PermissionDeniedError ||
  error instanceof NotFoundError ||
  error instanceof UnprocessableEntityError;

const RETRY_AFTER_MIN_MS = 1_000;
const RETRY_AFTER_MAX_MS = 60_000;

const positiveMs = (ms: number): number | undefined =>
  Number.isFinite(ms) && ms > 0 ? ms : undefined;

/**
 * How long the server asked us to wait, clamped to 1-60 s, or `undefined` if it didn't say (or
 * said nonsense). Mirrors the Anthropic SDK: `retry-after-ms`, then `retry-after` as seconds or
 * an HTTP date. `now` is injectable for tests.
 */
export const retryAfterMs = (
  headers: Headers | undefined,
  now: number = Date.now(),
): number | undefined => {
  const millis = headers?.get('retry-after-ms');
  const seconds = headers?.get('retry-after');

  let wait: number | undefined;
  if (millis) {
    wait = positiveMs(Number.parseFloat(millis));
  }
  if (wait === undefined && seconds) {
    const asSeconds = Number.parseFloat(seconds);
    wait = Number.isNaN(asSeconds)
      ? positiveMs(Date.parse(seconds) - now)
      : positiveMs(asSeconds * 1000);
  }

  return wait === undefined
    ? undefined
    : Math.min(Math.max(wait, RETRY_AFTER_MIN_MS), RETRY_AFTER_MAX_MS);
};

/** Use as `throw toActivityFailure(error)`: returns the error to throw, retryable or not. */
export const toActivityFailure = (error: unknown): unknown => {
  if (isPermanentApiError(error)) {
    return ApplicationFailure.nonRetryable(
      `Claude API rejected the request (HTTP ${String(error.status)} ${error.constructor.name})`,
      REQUEST_REJECTED,
    );
  }

  // A transient API error: retryable, with our own message instead of the upstream one.
  if (error instanceof APIError && error.status !== undefined) {
    const delay = retryAfterMs(error.headers as Headers | undefined);
    return ApplicationFailure.create({
      message: `Claude API error, will retry (HTTP ${String(error.status)} ${error.constructor.name})`,
      type: TRANSIENT,
      nonRetryable: false,
      ...(delay !== undefined ? { nextRetryDelay: delay } : {}),
    });
  }

  return error;
};

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
