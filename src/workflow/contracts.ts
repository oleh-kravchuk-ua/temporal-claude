/**
 * Contracts: the agent workflow's public API — signal/query definitions and payload
 * schemas + inferred types. The single source of truth imported by the workflow, the CLI
 * client, and the HTTP API (one contract per file, merged here). The task queue is
 * deployment config (`AppConfig.taskQueue`), not part of this protocol contract.
 */

import { defineQuery, defineSignal } from '@temporalio/workflow';
import { z } from 'zod';

import type { AgentState } from './types';

/** Input required to start an agent run. */
export const AgentInputSchema = z.object({
  topic: z.string().trim().min(1),
});

export type AgentInput = z.infer<typeof AgentInputSchema>;

export type AgentResultStatus = 'completed' | 'rejected' | 'cancelled';

/** Terminal outcome returned by the agent workflow. */
export interface AgentResult {
  readonly status: AgentResultStatus;
  readonly finalAnswer?: string;
  readonly revision: number;
  readonly stepCount: number;
}

export const ApprovePlanInputSchema = z.object({
  approved: z.boolean(),
  feedback: z.string().trim().min(1).optional(),
});

export type ApprovePlanInput = z.infer<typeof ApprovePlanInputSchema>;

/** Approve the current plan, or reject it with optional feedback for a re-plan. */
export const approvePlan = defineSignal<[ApprovePlanInput]>('approvePlan');

/** Request a graceful cancellation of the run. */
export const cancelAgent = defineSignal<[]>('cancel');

/** Guidance injected mid-run; must be non-empty. */
export const GuidanceSchema = z.string().trim().min(1);

/** Inject guidance that is applied to subsequent step execution. */
export const provideGuidance = defineSignal<[string]>('provideGuidance');

/** Read-only snapshot of the current run state. */
export const getState = defineQuery<AgentState>('getState');
