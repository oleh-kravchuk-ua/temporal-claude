import { defineSignal } from '@temporalio/workflow';
import { z } from 'zod';

export const ApprovePlanInputSchema = z.object({
  approved: z.boolean(),
  feedback: z.string().trim().min(1).optional(),
});

export type ApprovePlanInput = z.infer<typeof ApprovePlanInputSchema>;

/** Approve the current plan, or reject it with optional feedback for a re-plan. */
export const approvePlan = defineSignal<[ApprovePlanInput]>('approvePlan');
