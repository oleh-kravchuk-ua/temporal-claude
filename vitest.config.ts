import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'features/**/*.test.ts'],
    // Temporal's TestWorkflowEnvironment can take a moment to boot its test server.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
