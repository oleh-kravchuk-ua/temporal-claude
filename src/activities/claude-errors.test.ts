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

import { assertUsable, retryAfterMs, toActivityFailure } from './claude-errors';

const headers = new Headers();

describe('toActivityFailure', () => {
  const untouched: ReadonlyArray<readonly [string, unknown]> = [
    ['APIConnectionError', new APIConnectionError({ message: 'reset' })],
    ['APIConnectionTimeoutError', new APIConnectionTimeoutError()],
    ['an unknown error', new Error('mystery')],
  ];

  it.each(untouched)('leaves %s retryable (returned unchanged)', (_name, error) => {
    expect(toActivityFailure(error)).toBe(error);
  });

  const transient: ReadonlyArray<readonly [string, unknown, number]> = [
    ['RateLimitError 429', new RateLimitError(429, {}, 'boom', headers), 429],
    ['InternalServerError 500', new InternalServerError(500, {}, 'boom', headers), 500],
    [
      'InternalServerError 529 (overloaded)',
      new InternalServerError(529, {}, 'boom', headers),
      529,
    ],
    ['ConflictError 409', new ConflictError(409, {}, 'boom', headers), 409],
  ];

  it.each(transient)(
    'turns %s into a retryable failure with a sanitized message',
    (_name, error, status) => {
      const failure = toActivityFailure(error) as ApplicationFailure;

      expect(failure).toBeInstanceOf(ApplicationFailure);
      expect(failure.nonRetryable).toBe(false);
      expect(failure.message).toContain(String(status));
      expect(failure.message).not.toContain('boom');
      expect(failure.nextRetryDelay).toBeUndefined();
    },
  );

  it('carries the server retry-after as the next retry delay, never the upstream message', () => {
    const error = new RateLimitError(
      429,
      {},
      'org 4f2a is over its limit (req_123)',
      new Headers({ 'retry-after': '7' }),
    );

    const failure = toActivityFailure(error) as ApplicationFailure;

    expect(failure.nonRetryable).toBe(false);
    expect(failure.nextRetryDelay).toBe(7000);
    expect(failure.message).not.toContain('req_123');
    expect(failure.message).not.toContain('4f2a');
  });

  it('honors retry-after on overloaded (529) responses too', () => {
    const error = new InternalServerError(
      529,
      {},
      'overloaded',
      new Headers({ 'retry-after': '12' }),
    );

    expect((toActivityFailure(error) as ApplicationFailure).nextRetryDelay).toBe(12_000);
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

describe('retryAfterMs', () => {
  const NOW = Date.parse('2026-09-25T12:00:00Z');
  const parse = (init: Record<string, string>): number | undefined =>
    retryAfterMs(new Headers(init), NOW);

  it('reads retry-after in seconds (integers and fractions)', () => {
    expect(parse({ 'retry-after': '7' })).toBe(7000);
    expect(parse({ 'retry-after': '2.5' })).toBe(2500);
  });

  it('prefers retry-after-ms over retry-after', () => {
    expect(parse({ 'retry-after-ms': '1500', 'retry-after': '30' })).toBe(1500);
  });

  it('reads an HTTP date', () => {
    expect(parse({ 'retry-after': 'Fri, 25 Sep 2026 12:00:30 GMT' })).toBe(30_000);
  });

  it('caps a very long wait at 60 s and floors a tiny one at 1 s', () => {
    expect(parse({ 'retry-after': '600' })).toBe(60_000);
    expect(parse({ 'retry-after': '0.2' })).toBe(1000);
  });

  it.each([
    ['missing', {}],
    ['zero', { 'retry-after': '0' }],
    ['negative', { 'retry-after': '-3' }],
    ['garbage', { 'retry-after': 'soon' }],
    ['a date in the past', { 'retry-after': 'Fri, 25 Sep 2026 11:59:00 GMT' }],
  ])('ignores a %s header', (_name, init) => {
    expect(parse(init)).toBeUndefined();
  });

  it('copes with no headers at all', () => {
    expect(retryAfterMs(undefined, NOW)).toBeUndefined();
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
