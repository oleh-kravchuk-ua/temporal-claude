/**
 * Worker entry point: the long-lived process that hosts and executes the workflow + activities.
 * This is where workflows actually run — the `temporal` server only orchestrates. Run with
 * `npm run worker` (a local dev server must be up: `temporal server start-dev`).
 */

import { fileURLToPath } from 'node:url';

import { Worker } from '@temporalio/worker';

import { createAiToolsActivities } from './activities';

import { loadConfig } from './infra/config';
import { createLogger } from './infra/logger';
import { installProcessErrorHandlers } from './infra/process-errors';
import { createWorkerConnection } from './infra/temporal';

const run = async (): Promise<void> => {
  const config = loadConfig();
  const logger = createLogger(config);

  installProcessErrorHandlers(logger);

  const connection = await createWorkerConnection(config);

  try {
    const worker = await Worker.create({
      connection,
      namespace: config.temporal.connection.namespace,
      taskQueue: config.temporal.taskQueue,
      // Temporal bundles the workflow file separately; point it at the module path.
      workflowsPath: fileURLToPath(new URL('./workflow/agent.workflow.ts', import.meta.url)),
      activities: createAiToolsActivities(logger),
    });

    logger.info(
      { taskQueue: config.temporal.taskQueue, address: config.temporal.connection.address },
      'Worker started; polling for tasks',
    );

    // Worker.run() handles SIGINT/SIGTERM for graceful shutdown.
    await worker.run();

    logger.info('Worker stopped');
  } catch (error) {
    logger.error({ error }, 'Worker failed');
    process.exitCode = 1;
  } finally {
    await connection.close();
  }
};

run().catch((error: unknown) => {
  // Logger may not exist yet if config/connection failed, so use console here.
  console.error('Worker failed to start:', error);
  process.exitCode = 1;
});
