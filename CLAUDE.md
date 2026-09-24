# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project purpose

A small application to test orchestration for running AI tools within [Temporal](https://temporal.io). Concretely: a **human-in-the-loop AI agent** — a Temporal workflow that plans a task, waits for a human to approve the plan (via signals), executes the steps, and synthesizes a result. The "AI" is **mocked** (offline, no API keys); the point is the durable-execution orchestration, not real inference.

## Current state — implemented (all phases complete)

The app is built and verified: worker, Fastify REST API, and CLI client all run; **22 tests
pass** (unit + endpoint e2e), and the full stack runs under Docker Compose. `README.md` is the
user-facing guide; `docs/{PLAN,SPEC}.md` capture the design and remain the reference for
_why_ things are shaped this way.

- **`docs/SPEC.md`** — the behavioral contract: domain model, workflow state machine,
  signal/query/activity/HTTP contracts, config/logging contracts, layer-boundary rules.
- **`docs/PLAN.md`** — architecture, run model, toolchain, Docker decisions.

## Architecture (see `docs/PLAN.md`)

Single package, flat and Temporal-idiomatic — the workflow depends only on the `AiToolsActivities` port, never on an adapter:

```
src/
├── workflow/       # agentWorkflow + AgentRun + ports.ts (AiToolsActivities) + contracts.ts (signals/queries) + types.ts — MUST NOT import infra/activities/http/cli
├── activities/     # AiToolsActivities strategies (mock today; Claude-backed later) + index.ts (the Strategy selector)
├── infra/          # config, logger (pino), Temporal connection, process-error handlers
├── worker.ts       # entrypoint: hosts the workflow + activities
├── http/           # Fastify HITL REST API (a Temporal client)
└── cli/            # start-only CLI client
```

Key mental model: **the workflow runs inside the worker**, not a container of its own. The `temporal` server is the cluster; the CLI, the Fastify API, and the Web UI are all just _clients_ that start/signal/query workflows. Human-in-the-loop approval happens via Web UI (`:8233`), Temporal CLI, or the REST API (`:3000`) — there is no bespoke frontend.

## Commands

| command                           | purpose                                             |
| --------------------------------- | --------------------------------------------------- |
| `npm run worker`                  | run the worker (hosts workflows + activities)       |
| `npm run api`                     | run the Fastify HITL REST API (`:3000`)             |
| `npm run start`                   | CLI client — start one workflow, print its id, exit |
| `npm run build`                   | strict typecheck (`tsc --noEmit`)                   |
| `npm run lint` / `lint:fix`       | ESLint (check / auto-fix)                           |
| `npm run format` / `format:check` | Prettier write / verify                             |
| `npm test` / `npm run test:watch` | Vitest (single file: `npx vitest run <path>`)       |

Local Temporal cluster for manual runs: `temporal server start-dev` (gRPC `:7233`, Web UI `:8233`). Full run + HITL instructions live in the **`temporal-agent-ops`** skill.

## Toolchain / conventions

- **ES modules only** (`"type": "module"`) — never `require`/`module.exports`; use `import type` for type-only imports.
- **Prefer arrow function expressions** (`const f = () => {}`) over `function` declarations — enforced by ESLint `func-style`.
- **Strict TypeScript** via `@tsconfig/strictest` (`moduleResolution: Bundler`). Mind `noUncheckedIndexedAccess` (guard index access) and `verbatimModuleSyntax`.
- **Zod at the edges** — validate env, workflow input, signal payloads, and HTTP requests; infer types from schemas (single source of truth). Internal layer contracts stay plain TS interfaces.
- **Config** via `src/infra/config/` only (the single reader of `process.env`): `.env` + `.env.local` (both git-ignored) + committed `.env.example`; runs with no env files thanks to defaults. `AppConfig` is grouped by concern (`http.*`, `temporal.connection.*`, `temporal.taskQueue`); flat env vars map onto it.
- **Process safety:** long-lived entrypoints (worker, API) install `unhandledRejection` / `uncaughtException` handlers (`src/infra/process-errors.ts`) that log and exit non-zero so the supervisor restarts a clean process.
- **Logging** via **pino** (shared `loggerOptions`): the worker uses `createLogger`, the API uses Fastify + per-request `request.log`, and activities receive an **injected** logger (`createAiToolsActivities(logger)`) — not `@temporalio/activity`'s `log` (throws outside a context, breaks unit tests). The **workflow** (`AgentRun`) logs only through `@temporalio/workflow`'s `log` (message-first, sinks), never pino (determinism).
- **Boundary rules** (enforced by ESLint `no-restricted-imports`): `workflow` must not import `infra`/`activities`/`http`/`cli` — it depends on the port (`workflow/ports.ts`), not an adapter; `workflow/contracts.ts` is the sole owner of signal/query names; activity implementations `satisfies AiToolsActivities`.
- **Testing (three tiers):** _smoke_ = manual `curl` checklist (not automated); _unit_ = colocated `*.test.ts` beside the source, collaborators mocked (Vitest + `@temporalio/testing` time-skipping for the workflow); _feature/e2e_ = `features/` at repo root, everything wired for real. Scripts: `test` (all), `test:unit` (`vitest run src`), `test:feature` (`vitest run features`). All automated tiers are self-contained (own test server) — no external cluster/worker needed. Prefer running a single test file while iterating.
- **All `@temporalio/*` packages must share one identical version.**
- **Git:** Conventional Commits (commitlint via husky `commit-msg`); husky `pre-commit` runs `format:check` + `lint` + `build`.

## Working with Temporal

The `temporal@temporal-marketplace` plugin is enabled (`.claude/settings.json`), providing the `temporal:temporal-developer` skill — use it for SDK authoring, determinism/non-determinism errors, versioning, and CLI. Use the project's own **`temporal-agent-ops`** skill for running/operating _this_ app. For library/API docs (Temporal, Fastify, Zod), prefer the **context7** MCP server over guessing.

## Repo tooling

- **MCP servers** (`.mcp.json`): `context7` only.
- **Slash commands** (`.claude/commands/`): `/verify` (test + lint status check), `/review` (stack-aware security/performance/determinism/test-gap review), `/test-coverage` (coverage analysis that respects `vitest.config.ts`'s intentional excludes) — all three written for this project's actual stack (Fastify + Temporal + Vitest), not inherited from elsewhere.
- **Permissions/hooks** (`.claude/settings.json`, `settings.local.json`): npm scripts + read-only/commit git commands allowed; destructive commands denied. A `Stop` desktop-notification hook is set locally. No `PostToolUse` formatting hook — formatting is handled by the husky `pre-commit`.
