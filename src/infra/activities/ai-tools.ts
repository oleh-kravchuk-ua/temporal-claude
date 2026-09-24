/**
 * Infra adapter: the concrete implementation of the `AiToolsActivities` port, registered as
 * Temporal activities by the worker. Today it's a MOCK — deterministic, offline, no I/O — so
 * the demo runs without API keys. In a real system this is exactly where an LLM call would
 * live (I/O, non-deterministic), which is why it belongs in `infra`, not the pure domain.
 *
 * A logger is injected (rather than using `@temporalio/activity`'s `log`, which throws outside
 * an activity context) so the activities log in production yet stay directly unit-testable.
 */

import type { Logger } from 'pino';

import type { AiToolsActivities } from '../../application/ports';
import type { ToolName } from '../../domain';

export const createAiToolsActivities = (logger: Logger): AiToolsActivities => ({
  planTask: (topic, feedback) => {
    logger.debug({ topic, feedback }, 'planTask');
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

    return Promise.resolve({
      topic: trimmedTopic,
      steps: withFeedback.map((entry, index) => ({ id: index + 1, ...entry })),
    });
  },

  runTool: (step, guidance) => {
    logger.debug({ stepId: step.id, tool: step.tool }, 'runTool');
    const hint = guidance.length > 0 ? ` (guidance: ${guidance.join('; ')})` : '';
    return Promise.resolve({
      stepId: step.id,
      output: `[${step.tool}] ${step.description}${hint}`,
    });
  },

  synthesize: (topic, results) => {
    logger.debug({ topic, steps: results.length }, 'synthesize');
    const body = results.map((result) => `- ${result.output}`).join('\n');
    return Promise.resolve(`Answer for "${topic}":\n${body}`);
  },
});
