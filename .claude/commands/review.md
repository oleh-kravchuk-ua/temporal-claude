# /review

Review the current git diff for the things a generic reviewer can't know about **this** stack:
Fastify + Temporal TypeScript SDK + Vitest + zod + pino, plus the Claude-backed activities.
For general correctness and security use the built-in `/code-review` and `/security-review`;
this command only adds the project-specific checks below.

## Steps

1. Read the current changes with `git diff HEAD` (staged + unstaged), or the files the user names.
2. Go through the checks below, skipping any the diff cannot affect.
3. Report findings in the format at the end.

## Checks

**Temporal workflow determinism** (`src/workflow/`)

- No `Date.now()`, `Math.random()` or direct I/O in workflow code — that belongs in activities.
- No `console`/pino in workflow code; log through `@temporalio/workflow`'s `log`.
- Signal and query handlers stay synchronous: no sleeping, no activities.
- `workflow/` imports nothing from `infra`, `activities`, `http` or `cli`.
- A zod-invalid signal payload is logged and ignored, never thrown (a signal can't fail its sender).

**Boundaries and secrets**

- Zod validates every boundary: HTTP body/params, signal payloads, env (via `infra/config` only).
- `ANTHROPIC_API_KEY` / `TEMPORAL_API_KEY` are never logged, echoed or put in error messages;
  check pino's `redact` covers the actual leak path, not just the happy-path field.
- Anything shown to clients (`AgentState.error`, HTTP error bodies) never carries raw upstream or
  activity error text; only messages our own code authored.
- A new env var is added to `infra/config`, `.env.example` and the README table.
- A process entrypoint that catches an error sets `process.exitCode` or rethrows.

**HTTP API** (`src/http/`)

- Stays a thin Temporal-client adapter: no business logic, imports only `workflow/contracts.ts`
  (+ `agent.workflow.ts` to start) and `infra`.
- Unexpected errors map to a generic `500 INTERNAL`; nothing internal leaks.
- Helmet and CORS stay registered. An unauthenticated endpoint that starts workflows is accepted
  scope (demo app, no auth by design) — note it, don't block on it, unless the diff changed that.

**Claude adapter** (`src/activities/claude-*`, `activities/index.ts`)

- Transient API failures (429, 5xx) are retryable `ApplicationFailure`s with a sanitized message
  and the server's `retry-after` as `nextRetryDelay`; connection errors pass through; permanent
  ones (400/401/403/404/422, refusal, truncation, empty output) are non-retryable.
- The client keeps `maxRetries: 0` and a timeout below `ACTIVITY_START_TO_CLOSE_MS`.
- `claude-sonnet-5` requests send no `temperature`/`top_p`/`budget_tokens`/prefill, and set
  `thinking: { type: 'disabled' }` explicitly.
- Model output is validated with zod before use; user text stays in the escaped user turn, never
  the system prompt; prompts and completions are not logged above `debug`.

**Tests**

- New branches and error paths have tests; the mock provider stays the default and tests stay offline.
- **Not a gap:** `workflow/agent-run.ts` and `workflow/agent.workflow.ts` run in Temporal's
  sandbox, which v8 coverage can't instrument (see `vitest.config.ts` excludes) — they are covered
  by `agent.workflow.test.ts`. Entrypoints and `cli/claude-check.ts` are verified by running them.

## Output

For each finding: severity (**CRITICAL** must fix before merge · **HIGH** should fix before merge ·
**MEDIUM** fix soon · **LOW** nice to have), `file:line`, why it matters, and a suggested fix.
Group by the headings above, say plainly when a group has no issues, and end with
**Overall: PASS / NEEDS ATTENTION**.
