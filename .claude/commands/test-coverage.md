# /test-coverage

Analyze current test coverage (Vitest + `@vitest/coverage-v8`) and generate tests for
genuinely uncovered code paths.

## Steps

1. Run `npm test -- --coverage` and review the report.
2. Identify files/functions below 80% coverage, **excluding** anything listed in
   `vitest.config.ts`'s `coverage.exclude` — those are deliberately excluded, not
   under-tested:
   - `workflow/agent-run.ts` / `workflow/agent.workflow.ts` run inside Temporal's isolated
     workflow sandbox, which `v8` cannot instrument no matter how well they're tested
     (confirmed via the SDK source: `log()`/`condition()` throw outside a real workflow
     execution). Their actual behavior is verified by `agent.workflow.test.ts` via
     `TestWorkflowEnvironment`.
   - `worker.ts`, `http/server.ts`, `cli/client.ts` (entrypoints) and
     `infra/temporal.ts`/`logger.ts`/`process-errors.ts` (thin plumbing) are verified by
     starting them for real (see `docs/PLAYBOOK.md`), not unit tests.
3. For each remaining, genuinely uncovered path:
   - Understand what the code does
   - Write a test that exercises it — colocated `*.test.ts` for units, extend
     `features/http-api.feature.test.ts` for anything that needs a real Fastify app + worker
   - Include edge cases and error conditions
4. Run the tests and fix any failures.
5. Re-run coverage to confirm improvement.

## Output a summary

- Starting coverage percentage
- Number of new tests written
- Any bugs discovered during testing
- Final coverage percentage

If every remaining gap is inside the excluded list above, say so explicitly instead of
writing tests just to move a percentage that can't move — see the reasoning captured in
`vitest.config.ts`'s exclude comments.
