/**
 * Infra adapter: the concrete implementation of the `AiToolsActivities` port, registered as
 * Temporal activities by the worker. Today it's a MOCK — deterministic, offline, no I/O — so
 * the demo runs without API keys. In a real system this is exactly where an LLM call would
 * live (I/O, non-deterministic), which is why it belongs in `infra`, not the pure domain.
 */

import type { AiToolsActivities } from '../../application/ports';
import type { Plan, PlanStep, StepResult, ToolName } from '../../domain';

export const planTask = async (topic: string, feedback?: string): Promise<Plan> => {
  const trimmedTopic = topic.trim();
  const refinement = feedback?.trim();

  const outline: ReadonlyArray<{ tool: ToolName; description: string }> = [
    { tool: 'search', description: `Research sources on "${trimmedTopic}"` },
    { tool: 'summarize', description: `Summarize key findings about "${trimmedTopic}"` },
    { tool: 'draft', description: `Draft a concise answer on "${trimmedTopic}"` },
  ];

  const withFeedback = refinement
    ? [
        {
          tool: 'search' as ToolName,
          description: `Re-research addressing feedback: ${refinement}`,
        },
        ...outline,
      ]
    : outline;

  return {
    topic: trimmedTopic,
    steps: withFeedback.map((entry, index) => ({
      id: index + 1,
      description: entry.description,
      tool: entry.tool,
    })),
  };
};

export const runTool = async (step: PlanStep, guidance: readonly string[]): Promise<StepResult> => {
  const hint = guidance.length > 0 ? ` (guidance: ${guidance.join('; ')})` : '';
  return {
    stepId: step.id,
    output: `[${step.tool}] ${step.description}${hint}`,
  };
};

export const synthesize = async (
  topic: string,
  results: readonly StepResult[],
): Promise<string> => {
  const body = results.map((result) => `- ${result.output}`).join('\n');
  return `Answer for "${topic}":\n${body}`;
};

/** Compile-time guarantee that this module's activities satisfy the port. */
export const aiToolsActivities = { planTask, runTool, synthesize } satisfies AiToolsActivities;
