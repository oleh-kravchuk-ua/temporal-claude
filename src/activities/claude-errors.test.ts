import {
  APIConnectionError,
  APIConnectionTimeoutError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError,
} from '@anthropic-ai/sdk';
import type { Message } from '@anthropic-ai/sdk/resources/messages';
import { ApplicationFailure } from '@temporalio/activity';
import { describe, it, expect } from 'vitest';

import { assertUsable, toActivityFailure } from './claude-errors';

const headers = new Headers();

describe('toActivityFailure', () => {
  const retryable: ReadonlyArray<readonly [string, unknown]> = [
    ['RateLimitError 429', new RateLimitError(429, {}, 'boom', headers)],
    ['InternalServerError 500', new InternalServerError(500, {}, 'boom', headers)],
    ['InternalServerError 529 (overloaded)', new InternalServerError(529, {}, 'boom', headers)],
    ['ConflictError 409', new ConflictError(409, {}, 'boom', headers)],
    ['APIConnectionError', new APIConnectionError({ message: 'reset' })],
    ['APIConnectionTimeoutError', new APIConnectionTimeoutError()],
    ['an unknown error', new Error('mystery')],
  ];

  it.each(retryable)('leaves %s retryable (returned unchanged)', (_name, error) => {
    expect(toActivityFailure(error)).toBe(error);
  });

  const permanent: ReadonlyArray<readonly [string, unknown, number]> = [
    ['BadRequestError', new BadRequestError(400, {}, 'boom', headers), 400],
    ['AuthenticationError', new AuthenticationError(401, {}, 'boom', headers), 401],
    ['PermissionDeniedError', new PermissionDeniedError(403, {}, 'boom', headers), 403],
    ['NotFoundError', new NotFoundError(404, {}, 'boom', headers), 404],
    ['UnprocessableEntityError', new UnprocessableEntityError(422, {}, 'boom', headers), 422],
  ];

  it.each(permanent)('turns %s into a non-retryable failure', (_name, error, status) => {
    const failure = toActivityFailure(error);

    expect(failure).toBeInstanceOf(ApplicationFailure);
    expect((failure as ApplicationFailure).nonRetryable).toBe(true);
    expect((failure as ApplicationFailure).message).toContain(String(status));
  });

  it('does not copy the upstream message (which could echo request details) into the failure', () => {
    const upstream = new AuthenticationError(401, {}, 'invalid x-api-key sk-secret-123', headers);

    expect((toActivityFailure(upstream) as ApplicationFailure).message).not.toContain('sk-secret');
  });
});

describe('assertUsable', () => {
  const message = (
    overrides: Partial<Pick<Message, 'stop_reason' | 'content' | 'stop_details'>>,
  ): Pick<Message, 'stop_reason' | 'content' | 'stop_details'> => ({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'hello', citations: null }],
    stop_details: null,
    ...overrides,
  });

  const expectNonRetryable = (fn: () => unknown, pattern: RegExp): void => {
    try {
      fn();
    } catch (error) {
      expect(error).toBeInstanceOf(ApplicationFailure);
      expect((error as ApplicationFailure).nonRetryable).toBe(true);
      expect((error as ApplicationFailure).message).toMatch(pattern);
      return;
    }
    expect.unreachable('expected assertUsable to throw');
  };

  it('returns the text of a normal completion', () => {
    expect(assertUsable(message({}))).toBe('hello');
  });

  it('joins multiple text blocks and ignores non-text blocks', () => {
    const text = assertUsable(
      message({
        content: [
          { type: 'thinking', thinking: '', signature: 's' },
          { type: 'text', text: 'a', citations: null },
          { type: 'text', text: 'b', citations: null },
        ],
      }),
    );

    expect(text).toBe('ab');
  });

  it('accepts stop_sequence', () => {
    expect(assertUsable(message({ stop_reason: 'stop_sequence' }))).toBe('hello');
  });

  it('fails non-retryably on refusal and names the category', () => {
    expectNonRetryable(
      () =>
        assertUsable(
          message({
            stop_reason: 'refusal',
            stop_details: { type: 'refusal', category: 'cyber', explanation: null },
          }),
        ),
      /refus.*cyber/i,
    );
  });

  it('fails non-retryably on refusal without a category', () => {
    expectNonRetryable(() => assertUsable(message({ stop_reason: 'refusal' })), /refus/i);
  });

  it.each(['max_tokens', 'model_context_window_exceeded', 'tool_use', 'pause_turn'] as const)(
    'fails non-retryably on stop_reason %s',
    (stopReason) => {
      expectNonRetryable(
        () => assertUsable(message({ stop_reason: stopReason })),
        new RegExp(stopReason),
      );
    },
  );

  it('fails non-retryably on a null stop_reason', () => {
    expectNonRetryable(() => assertUsable(message({ stop_reason: null })), /stop_reason/);
  });

  it('fails non-retryably when there is no text', () => {
    expectNonRetryable(() => assertUsable(message({ content: [] })), /no text/i);
    expectNonRetryable(
      () => assertUsable(message({ content: [{ type: 'text', text: '  ', citations: null }] })),
      /no text/i,
    );
  });
});
