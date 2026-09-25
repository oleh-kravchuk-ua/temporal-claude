import { ActivityFailure, ApplicationFailure, TimeoutFailure } from '@temporalio/workflow';
import { describe, expect, it } from 'vitest';

import { describeActivityFailure } from './failure-message';

type RetryState = ConstructorParameters<typeof ActivityFailure>[3];

const activityFailure = (
  cause: Error | undefined,
  retryState: RetryState = 'MAXIMUM_ATTEMPTS_REACHED',
) => new ActivityFailure('Activity task failed', 'planTask', '1', retryState, 'worker', cause);

describe('describeActivityFailure', () => {
  it('shows the message of a non-retryable failure (authored by our adapters, safe to show)', () => {
    const failure = activityFailure(
      ApplicationFailure.nonRetryable(
        'Claude API rejected the request (HTTP 401 AuthenticationError)',
        'ClaudeRequestRejected',
      ),
      'NON_RETRYABLE_FAILURE',
    );

    expect(describeActivityFailure(failure)).toBe(
      'Claude API rejected the request (HTTP 401 AuthenticationError)',
    );
  });

  it('never surfaces the message of a retryable failure (it may echo upstream details)', () => {
    const upstream = '429 {"error":{"message":"org 4f2a… rate limit","request_id":"req_123"}}';
    const failure = activityFailure(ApplicationFailure.create({ message: upstream }));

    const message = describeActivityFailure(failure);

    expect(message).not.toContain('req_123');
    expect(message).not.toContain('4f2a');
    expect(message).toContain('planTask');
    expect(message).toContain('MAXIMUM_ATTEMPTS_REACHED');
  });

  it('gives a generic description for a timeout cause', () => {
    const failure = activityFailure(
      new TimeoutFailure('timed out', undefined, 'START_TO_CLOSE'),
      'TIMEOUT',
    );

    expect(describeActivityFailure(failure)).toBe('Activity "planTask" failed (TIMEOUT)');
  });

  it('gives a generic description when there is no cause', () => {
    expect(describeActivityFailure(activityFailure(undefined))).toBe(
      'Activity "planTask" failed (MAXIMUM_ATTEMPTS_REACHED)',
    );
  });

  it('falls back gracefully for a non-retryable failure with an empty message', () => {
    const failure = activityFailure(ApplicationFailure.nonRetryable(''), 'NON_RETRYABLE_FAILURE');

    expect(describeActivityFailure(failure)).toBe(
      'Activity "planTask" failed (NON_RETRYABLE_FAILURE)',
    );
  });
});
