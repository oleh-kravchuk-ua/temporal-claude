# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project purpose

A small application to test orchestration for running AI tools within [Temporal](https://temporal.io). Concretely: a **human-in-the-loop AI agent** — a Temporal workflow that plans a task, waits for a human to approve the plan (via signals), executes the steps, and synthesizes a result. The "AI" is **mocked** by default (offline, no API keys) and switches to a real Claude-backed strategy with `AI_PROVIDER=claude`; the point is the durable-execution orchestration, not real inference.

`README.md` is the user-facing guide (run, REST API, config, state diagram); `docs/PLAYBOOK.md` has copy-paste manual scenarios. Open follow-ups: `docs/NEXT.md`.

## Architecture

Single package, flat and Temporal-idiomatic — the workflow depends only on the `AiToolsActivities` port, never on an adapter:

```
src/
├── workflow/       # agentWorkflow + AgentRun + ports.ts (AiToolsActivities) + contracts.ts (signals/queries) + types.ts — MUST NOT import infra/activities/http/cli
├── activities/     # AiToolsActivities strategies (mock + Claude-backed) + index.ts (the Strategy selector, picks by AI_PROVIDER)
├── infra/          # config, logger (pino), Temporal connection, process-error handlers
├── worker.ts       # entrypoint: hosts the workflow + activities
├── http/           # Fastify HITL REST API (a Temporal client)
└── cli/            # start-only CLI client
```

Key mental model: **the workflow runs inside the worker**, not a container of its own. The `temporal` server is the cluster; the CLI, the Fastify API, and the Web UI are all just _clients_ that start/signal/query workflows — there is no bespoke frontend.

## Workflow rules

- Lifecycle: `planning → awaiting_approval → executing → synthesizing → completed`, with `rejected` (3rd rejection, `MAX_REJECTIONS`) and `cancelled` as terminal exits. Diagram in `README.md`.
- `approvePlan` is ignored unless the run is `awaiting_approval`; invalid signal payloads are zod-validated, logged and **ignored** (a signal can't fail its sender); malformed `AgentInput` throws at workflow entry. `getState` is strictly read-only.
- **Determinism:** no `Date.now()`/`Math.random()`/I/O in workflow code (all non-determinism lives in activities); signal and query handlers are **non-async** and run no activities. Use the `temporal:temporal-developer` skill for anything deeper.
- Scope is deliberately small (KISS): one workflow, one task queue, in-memory only — **no** child workflows, continue-as-new, DB, or frontend. New tools = extend `ToolName` + a branch in the active activities implementation, without editing workflow control flow.

## HTTP API rules (`src/http`)

A thin Temporal-client adapter — validate input, call the Client, no business logic or state. Envelope: success `{ data }`, error `{ error: { code, message, details? } }`. Signals are fire-and-forget → `202`. Errors: workflow-not-found → `404`, zod → `400 VALIDATION_ERROR`, anything else → generic `500 INTERNAL` (never leak internals). Import only `workflow/contracts.ts` (+ `agent.workflow.ts` to start) and `infra` — never `activities` or workflow internals; reuse contract schemas in `http/schemas.ts` instead of re-declaring them. Routes (`http/routes/agents.ts`): `POST /agents` (start, `201`) · `GET /agents/:id` (`getState`) · `POST /agents/:id/{approve,guidance,cancel}` (signals, `202`) · `GET /healthz`. Bodies and examples: `README.md`.

## Claude adapter (`src/activities/claude-*`)

`AI_PROVIDER=mock` (default) or `claude`; `loadConfig` fails fast if `claude` has no `ANTHROPIC_API_KEY`. The SDK client is built in `activities/index.ts` and injected; the adapter takes a narrow `ClaudeClient` (only `messages.create`), so tests fake it and never touch the network. `npm run claude:check` verifies the connection and benchmarks latency against the real API.

- **Temporal owns retries:** the client uses `maxRetries: 0` and a timeout of `ACTIVITY_START_TO_CLOSE_MS` (1 minute, `workflow/activity-timeout.ts`) minus 15 s, so a hung call ends as a retryable timeout before the attempt does. `claude-errors.ts` rethrows transient failures (429, 5xx, 409, connection) and turns permanent ones (400/401/403/404/422, refusal, truncation, empty output) into non-retryable `ApplicationFailure`s. Failure messages never copy the upstream message.
- **`claude-sonnet-5` request rules:** send no `temperature`/`top_p`/`budget_tokens`/prefill (400). Omitting `thinking` runs adaptive, so the request sets `thinking: { type: 'disabled' }` explicitly. Steps use `effort: 'low'`.
- **Structured output is lossy:** `zodOutputFormat` turns the tool enum and `maxItems` into description hints only, so `planTask` re-validates the reply with `PlanOutputSchema` (1–8 steps, known tools) and assigns step ids itself.
- **Prompts** are pure functions in `claude-prompts.ts`; user text (topic, feedback, guidance, step outputs) is XML-escaped in the user turn and never in the system prompt. Step outputs have a concrete word budget (`STEP_MAX_WORDS = 250`); a test keeps it at least 4× inside `STEP_MAX_TOKENS` (2048), because hitting `max_tokens` fails the run ("be concise" alone let a step reach 89% of the cap).
- **Logging:** each call logs `durationMs`, token counts and `stopReason` at `debug`, never prompts or completions.
- **API key gotcha:** it must be created inside a workspace. An organization-scoped key gets `400 … not scoped to a workspace` on every request.
- **Measured (Sonnet 5, ~85 output tokens/s):** `planTask` ≈ 5 s, `runTool` ≈ 8 s, `synthesize` ≈ 8 s; a 3-step run finishes in about 30–60 s.

## Commands

| command                           | purpose                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------- |
| `npm run worker`                  | run the worker (hosts workflows + activities)                                     |
| `npm run api`                     | run the Fastify HITL REST API (`:3000`)                                           |
| `npm run start`                   | CLI client — start one workflow, print its id, exit                               |
| `npm run claude:check`            | check the Claude connection + short latency benchmark (real API, costs cents)     |
| `npm run build`                   | strict typecheck (`tsc --noEmit`)                                                 |
| `npm run lint` / `lint:fix`       | ESLint (check / auto-fix)                                                         |
| `npm run format` / `format:check` | Prettier write / verify                                                           |
| `npm run verify`                  | everything the pre-commit gate does + tests: format:check, lint, build, test      |
| `npm test` / `npm run test:watch` | Vitest (single file: `npx vitest run <path>`; coverage: `npm test -- --coverage`) |

Manual runs need a local cluster: `temporal server start-dev` (gRPC `:7233`, Web UI `:8233`). Full run + HITL instructions live in the **`temporal-agent-ops`** skill.

## Toolchain / conventions

- **ES modules only** (`"type": "module"`) — never `require`/`module.exports`; use `import type` for type-only imports.
- **Prefer arrow function expressions** (`const f = () => {}`) over `function` declarations — enforced by ESLint `func-style`.
- **Strict TypeScript** via `@tsconfig/strictest` (`moduleResolution: Bundler`). Mind `noUncheckedIndexedAccess` (guard index access) and `verbatimModuleSyntax`.
- **Zod at the edges** — validate env, workflow input, signal payloads, and HTTP requests; infer types from schemas (single source of truth). Internal layer contracts stay plain TS interfaces.
- **Config** via `src/infra/config/` only (the single reader of `process.env`): `.env` + `.env.local` (both git-ignored) + committed `.env.example`; runs with no env files thanks to defaults. `AppConfig` is grouped by concern (`http.*`, `temporal.connection.*`, `temporal.taskQueue`, `ai.*`); flat env vars map onto it. Add new variables to `.env.example` and the README table.
- **Process safety:** long-lived entrypoints (worker, API) install `unhandledRejection` / `uncaughtException` handlers (`src/infra/process-errors.ts`) that log and exit non-zero so the supervisor restarts a clean process.
- **Logging** via **pino** (shared `loggerOptions`): the worker uses `createLogger`, the API uses Fastify + per-request `request.log`, and activities receive an **injected** logger (`createAiToolsActivities(logger)`) — not `@temporalio/activity`'s `log` (throws outside a context, breaks unit tests). The **workflow** (`AgentRun`) logs only through `@temporalio/workflow`'s `log` (message-first, sinks), never pino (determinism). Never log secrets (pino `redact` covers `authorization`, `cookie`, `apiKey`, `temporalApiKey`).
- **Boundary rules** (enforced by ESLint `no-restricted-imports`): `workflow` must not import `infra`/`activities`/`http`/`cli` — it depends on the port (`workflow/ports.ts`), not an adapter; `workflow/contracts.ts` is the sole owner of signal/query names and payload schemas; activity implementations `satisfies AiToolsActivities`.
- **Testing (three tiers):** _smoke_ = manual `curl` checklist (`docs/PLAYBOOK.md`, not automated); _unit_ = colocated `*.test.ts` beside the source, collaborators mocked (Vitest + `@temporalio/testing` time-skipping for the workflow); _feature/e2e_ = `features/` at repo root, everything wired for real. Scripts: `test` (all), `test:unit` (`vitest run src`), `test:feature` (`vitest run features`). All automated tiers are self-contained (own test server) — no external cluster/worker needed. Prefer running a single test file while iterating.
- **All `@temporalio/*` packages must share one identical version.**
- **Git:** Conventional Commits (commitlint via husky `commit-msg`); husky `pre-commit` runs `format:check` + `lint` + `build`.

## Working with Temporal

The `temporal@temporal-marketplace` plugin is enabled (`.claude/settings.json`), providing the `temporal:temporal-developer` skill — use it for SDK authoring, determinism/non-determinism errors, versioning, and CLI. Use the project's own **`temporal-agent-ops`** skill for running/operating _this_ app. For library/API docs (Temporal, Fastify, Zod), prefer the **context7** MCP server over guessing.

## Repo tooling

- **MCP servers** (`.mcp.json`): `context7` only.
- **Slash commands** (`.claude/commands/`): `/review` only — the project-specific checks (Temporal determinism, boundaries, HTTP rules, Claude adapter). For generic review use the built-in `/code-review` / `/security-review`; run `npm run verify` instead of a verify command. Coverage excludes are explained in `vitest.config.ts`.
- **Formatting** is handled by the husky `pre-commit`, not a `PostToolUse` hook.
