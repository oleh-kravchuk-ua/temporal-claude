/**
 * Domain model: the agent's types and interfaces (the ubiquitous language). Declarations
 * only — no logic, no framework, no imports. This is the pure core every other layer speaks.
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

/** Lifecycle status of an agent run. `rejected`/`completed`/`cancelled` are terminal. */
export type AgentStatus =
  | 'planning'
  | 'awaiting_approval'
  | 'executing'
  | 'synthesizing'
  | 'completed'
  | 'rejected'
  | 'cancelled';

/** A snapshot of an agent run, exposed via the workflow's `getState` query. */
export interface AgentState {
  readonly status: AgentStatus;
  readonly topic: string;
  /** Increments on each (re)plan; starts at 1. */
  readonly revision: number;
  readonly plan?: Plan;
  /** Set while `status === 'executing'`. */
  readonly currentStepId?: number;
  readonly results: readonly StepResult[];
  /** Accumulated mid-run guidance from `provideGuidance`. */
  readonly guidance: readonly string[];
  /** Set on `status === 'completed'`. */
  readonly finalAnswer?: string;
}
