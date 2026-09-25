/**
 * Turns a failed activity into the short message shown to API clients in `AgentState.error`.
 *
 * Only failures our own adapters mark non-retryable are shown verbatim: those messages are
 * authored to be safe (status/category only, never the upstream body). A retryable failure that
 * ran out of attempts carries the raw error message, which can echo request details, so it gets
 * a generic description instead. The full failure is still in Temporal's history for operators.
 */

import { ApplicationFailure, type ActivityFailure } from '@temporalio/workflow';

export const describeActivityFailure = (failure: ActivityFailure): string => {
  const { cause } = failure;
  if (cause instanceof ApplicationFailure && cause.nonRetryable && cause.message !== '') {
    return cause.message;
  }
  return `Activity "${failure.activityType}" failed (${String(failure.retryState)})`;
};
