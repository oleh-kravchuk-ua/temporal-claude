/**
 * CLI client (start-only): starts one agent workflow, prints its id and how to approve it,
 * then exits. The workflow keeps running on the worker regardless — a human drives the
 * human-in-the-loop approval via the Web UI, the Temporal CLI, or the HTTP API.
 *
 * Run: `npm run start [-- "your topic here"]` (a worker must be polling the task queue).
 * Depends only on the application contracts + infra client/config — never on infra activities
 * or domain internals.
 */

import { randomUUID } from 'node:crypto';

import { agentWorkflow } from '../../application/agent.workflow';
import { loadConfig } from '../../infra/config';
import { createClient } from '../../infra/temporal';

const DEFAULT_TOPIC = 'Temporal vs cron for scheduled jobs';

const approvalHints = (workflowId: string): string =>
  [
    '',
    'The agent is now planning, then will await your approval. Approve it via:',
    '',
    '  Web UI:  http://localhost:8233  (open the workflow, send the `approvePlan` signal)',
    '',
    '  CLI:',
    `    temporal workflow query  -w ${workflowId} --type getState`,
    `    temporal workflow signal -w ${workflowId} --name approvePlan --input '{"approved":true}'`,
    '',
    '  HTTP API (if running):',
    `    curl localhost:3000/agents/${workflowId}`,
    `    curl -X POST localhost:3000/agents/${workflowId}/approve \\`,
    `         -H 'content-type: application/json' -d '{"approved":true}'`,
    '',
  ].join('\n');

const run = async (): Promise<void> => {
  const config = loadConfig();
  const topic = process.argv.slice(2).join(' ').trim() || DEFAULT_TOPIC;
  const workflowId = `agent-${randomUUID()}`;

  const { client, connection } = await createClient(config);
  try {
    const handle = await client.workflow.start(agentWorkflow, {
      taskQueue: config.taskQueue,
      workflowId,
      args: [{ topic }],
    });

    console.log(`Started agent workflow "${handle.workflowId}" for topic: ${topic}`);
    console.log(approvalHints(handle.workflowId));
  } finally {
    await connection.close();
  }
};

run().catch((error: unknown) => {
  console.error('Failed to start workflow:', error);
  process.exitCode = 1;
});
