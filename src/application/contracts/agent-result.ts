export type AgentResultStatus = 'completed' | 'rejected' | 'cancelled';

/** Terminal outcome returned by the agent workflow. */
export interface AgentResult {
  readonly status: AgentResultStatus;
  readonly finalAnswer?: string;
  readonly revision: number;
  readonly stepCount: number;
}
