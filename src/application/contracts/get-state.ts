import { defineQuery } from '@temporalio/workflow';

import type { AgentState } from '../../domain';

/** Read-only snapshot of the current run state. */
export const getState = defineQuery<AgentState>('getState');
