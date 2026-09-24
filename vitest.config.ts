import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'features/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // Temporal's TestWorkflowEnvironment can take a moment to boot its test server.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      // Specifying `include` reports files never imported by a test as 0%, instead of
      // silently omitting them.
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        // Thin Temporal/process plumbing — verified via live smoke, not mocked unit tests.
        'src/infra/temporal.ts',
        'src/infra/logger.ts',
        'src/infra/process-errors.ts',
        // Process entrypoints — bootstrap only (parse config, open a connection, listen/run);
        // verified by starting them for real (see docs/PLAYBOOK.md), not unit tests.
        'src/worker.ts',
        'src/http/server.ts',
        'src/cli/client.ts',
        // Diagnostics tool that calls the real API — run manually (`npm run claude:check`).
        'src/cli/claude-check.ts',
        // The workflow runs inside Temporal's own isolated V8 sandbox (for determinism), which
        // this process's coverage collector can't instrument — NOT a sign these are untested.
        // `agent-run.test.ts` covers the narrow slice reachable outside the sandbox (confirmed
        // by reading the SDK source: log()/condition() throw via assertInWorkflowContext
        // unless called from a real workflow execution); the state machine itself — the bulk
        // of this code — is covered by `agent.workflow.test.ts` via `TestWorkflowEnvironment`.
        'src/workflow/agent-run.ts',
        'src/workflow/agent.workflow.ts',
      ],
    },
  },
});
