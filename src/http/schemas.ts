/**
 * HTTP request schemas. Reuses the workflow contract schemas where they overlap (DRY) so
 * the REST surface can't drift from the workflow/signal payloads.
 */

import { z } from 'zod';

import { AgentInputSchema, ApprovePlanInputSchema, GuidanceSchema } from '../workflow/contracts';

/** `POST /agents` body — same shape as the workflow input. */
export const StartBodySchema = AgentInputSchema;

/** `POST /agents/:id/approve` body — same shape as the approvePlan signal. */
export const ApproveBodySchema = ApprovePlanInputSchema;

/** `POST /agents/:id/guidance` body. */
export const GuidanceBodySchema = z.object({ guidance: GuidanceSchema });

/** Route params carrying the workflow id. */
export const AgentParamsSchema = z.object({ id: z.string().min(1) });
