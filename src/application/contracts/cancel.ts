import { defineSignal } from '@temporalio/workflow';

/** Request a graceful cancellation of the run. */
export const cancelAgent = defineSignal<[]>('cancel');
