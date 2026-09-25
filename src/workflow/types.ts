/**
 * The agent's model types. Declarations only — no logic, no imports — shared by the
 * workflow, activities, and the HTTP/CLI adapters.
 */

/** The mocked tools the agent can invoke for a plan step. */
export type ToolName = 'search' | 'summarize' | 'draft';

/** A single step in an agent plan. `id` is 1-based and stable within a plan revision. */
export interface PlanStep {
  readonly id: number;
  readonly description: string;
  readonly tool: ToolName;
}

/** A plan is an ordered, non-empty list of steps for a topic. */
export interface Plan {
  readonly topic: string;
  readonly steps: readonly PlanStep[];
}

/** The output of executing one plan step. */
export interface StepResult {
  readonly stepId: number;
  readonly output: string;
}

/**
 * Lifecycle status of an agent run. `rejected`/`completed`/`cancelled`/`failed` are terminal.
 * `failed` means an activity failed for good (permanent error or retries exhausted); the
 * workflow itself also ends FAILED in Temporal.
 */
export type AgentStatus =
  | 'planning'
  | 'awaiting_approval'
  | 'executing'
  | 'synthesizing'
  | 'completed'
  | 'rejected'
  | 'cancelled'
  | 'failed';

/** A snapshot of an agent run, exposed via the workflow's `getState` query. */
export interface AgentState {
  readonly status: AgentStatus;
  readonly topic: string;
  /** Increments on each (re)plan; starts at 1. */
  readonly revision: number;
  readonly plan?: Plan;
  /** Set while `status === 'executing'`; left set on `failed` to show which step failed. */
  readonly currentStepId?: number;
  readonly results: readonly StepResult[];
  /** Accumulated mid-run guidance from `provideGuidance`. */
  readonly guidance: readonly string[];
  /** Set on `status === 'completed'`. */
  readonly finalAnswer?: string;
  /** Set on `status === 'failed'`: a short, client-safe reason (see `failure-message.ts`). */
  readonly error?: string;
}
