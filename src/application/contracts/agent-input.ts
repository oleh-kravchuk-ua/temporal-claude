import { z } from 'zod';

/** Input required to start an agent run. */
export const AgentInputSchema = z.object({
  topic: z.string().trim().min(1),
});

export type AgentInput = z.infer<typeof AgentInputSchema>;
