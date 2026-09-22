import type { Plan, PlanStep, StepResult } from '../domain';

/**
 * Ports: the dependencies the application core (the workflow) declares and the outside world
 * must implement (DIP). Defined here — beside the workflow that proxies it — not in `domain`,
 * because "Activities" is a Temporal orchestration concept, not part of the pure model. Infra
 * provides the concrete adapter (`satisfies AiToolsActivities`); the workflow never imports infra.
 *
 * Kept minimal (ISP): exactly the three capabilities the workflow orchestrates. Methods are
 * async because they run as Temporal activities.
 */
export interface AiToolsActivities {
  planTask: (topic: string, feedback?: string) => Promise<Plan>;
  runTool: (step: PlanStep, guidance: readonly string[]) => Promise<StepResult>;
  synthesize: (topic: string, results: readonly StepResult[]) => Promise<string>;
}
