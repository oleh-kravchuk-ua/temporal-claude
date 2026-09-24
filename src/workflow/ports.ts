import type { Plan, PlanStep, StepResult } from './types';

/**
 * Ports: the dependencies the workflow declares and the outside world must implement (DIP)
 * — also the Strategy interface `activities/` implementations are selected behind (see
 * `activities/index.ts`). The workflow proxies this port and never imports an adapter
 * directly.
 *
 * Kept minimal (ISP): exactly the three capabilities the workflow orchestrates. Methods are
 * async because they run as Temporal activities.
 */
export interface AiToolsActivities {
  planTask: (topic: string, feedback?: string) => Promise<Plan>;
  runTool: (step: PlanStep, guidance: readonly string[]) => Promise<StepResult>;
  synthesize: (topic: string, results: readonly StepResult[]) => Promise<string>;
}
