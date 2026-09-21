/**
 * Worker entry point: the long-lived process that hosts and executes the workflow + activities.
 * This is where workflows actually run — the `temporal` server only orchestrates. Run with
 * `npm run worker` (a local dev server must be up: `temporal server start-dev`).
 */

import { fileURLToPath } from 'node:url';

import { Worker } from '@temporalio/worker';

import { aiToolsActivities } from './activities/ai-tools';
import { loadConfig } from './config';
import { createWorkerConnection } from './temporal';
import { createLogger } from './logger';

const run = async (): Promise<void> => {
  const config = loadConfig();
  const logger = createLogger(config);
  const connection = await createWorkerConnection(config);

  try {
    const worker = await Worker.create({
      connection,
      namespace: config.temporalNamespace,
      taskQueue: config.taskQueue,
      // Temporal bundles the workflow file separately; point it at the module path.
      workflowsPath: fileURLToPath(new URL('../application/agent.workflow.ts', import.meta.url)),
      activities: aiToolsActivities,
    });

    logger.info(
      { taskQueue: config.taskQueue, address: config.temporalAddress },
      'Worker started; polling for tasks',
    );
    // Worker.run() handles SIGINT/SIGTERM for graceful shutdown.
    await worker.run();
    logger.info('Worker stopped');
  } catch (error) {
    logger.error({ error }, 'Worker failed');
  } finally {
    await connection.close();
  }
};

run().catch((error: unknown) => {
  // Logger may not exist yet if config/connection failed, so use console here.
  console.error('Worker failed to start:', error);
  process.exitCode = 1;
});
