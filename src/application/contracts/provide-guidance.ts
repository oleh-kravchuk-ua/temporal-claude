import { defineSignal } from '@temporalio/workflow';
import { z } from 'zod';

/** Guidance injected mid-run; must be non-empty. */
export const GuidanceSchema = z.string().trim().min(1);

/** Inject guidance that is applied to subsequent step execution. */
export const provideGuidance = defineSignal<[string]>('provideGuidance');
