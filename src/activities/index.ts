/**
 * Strategy selection point: picks the concrete `AiToolsActivities` implementation the
 * worker registers. Today only the mock exists; extend the switch here when a real
 * implementation (e.g. Claude-backed) is added, so the worker keeps calling one factory
 * without knowing which strategy it got.
 */

import type { Logger } from 'pino';

import type { AiToolsActivities } from '../workflow/ports';

import { createMockAiTools } from './mock-ai-tools';

export const createAiToolsActivities = (logger: Logger): AiToolsActivities =>
  createMockAiTools(logger);
