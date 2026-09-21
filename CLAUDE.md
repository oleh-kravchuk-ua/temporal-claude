# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project purpose

A small application to test orchestration for running AI tools within [Temporal](https://temporal.io). Concretely: a **human-in-the-loop AI agent** — a Temporal workflow that plans a task, waits for a human to approve the plan (via signals), executes the steps, and synthesizes a result. The "AI" is **mocked** (offline, no API keys); the point is the durable-execution orchestration, not real inference.

## Current state — planning complete, implementation not started

The design is fully specified but **no application code exists yet**. `index.js` is still a `console.log`, and `package.json` has only a placeholder `test` script. The four `@temporalio/*` runtime packages are installed; nothing else is.

**The plan is the source of truth — read it before writing code:**

- **`docs/PLAN.md`** — locked decisions, architecture, run model, toolchain, Docker.
- **`docs/SPEC.md`** — the behavioral contract: domain model, workflow state machine, signal/query/activity/HTTP contracts (names + payload types), config/logging contracts, layer-boundary rules, principles, acceptance criteria.
- **`docs/TASKS.md`** — phased, checkboxed build order (Phase 0 → 7). Implement in this order; each task cites the SPEC section it satisfies.

When implementing, follow `docs/TASKS.md` phase by phase and keep it in sync (check boxes off). When the code exists, update this "Current state" section with the real, verified commands.

## Architecture (target — see `docs/PLAN.md`)

Single package, **layered DDD**, dependencies point **inward only**:

```
src/
├── domain/         # pure business logic + types + AiToolsActivities port — NO @temporalio imports
├── application/    # workflows + contracts.ts (TASK_QUEUE, signal/query defs) — MUST NOT import infra
├── infra/          # config, logger (pino), Temporal connection, activity adapters, worker  ← workflows run in the worker
└── interfaces/     # driving adapters: cli/ (start-only client) + http/ (Fastify HITL REST API)
```

Key mental model: **the workflow runs inside the worker**, not a container of its own. The `temporal` server is the cluster; the CLI, the Fastify API, and the Web UI are all just _clients_ that start/signal/query workflows. Human-in-the-loop approval happens via Web UI (`:8233`), Temporal CLI, or the REST API (`:3000`) — there is no bespoke frontend.

## Commands (target — added in Phase 0, not yet present)

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

## Toolchain / conventions (decided; enforced once wired)

- **ES modules only** (`"type": "module"`) — never `require`/`module.exports`; use `import type` for type-only imports.
- **Strict TypeScript** via `@tsconfig/strictest` (`moduleResolution: Bundler`). Mind `noUncheckedIndexedAccess` (guard index access) and `verbatimModuleSyntax`.
- **Zod at the edges** — validate env, workflow input, signal payloads, and HTTP requests; infer types from schemas (single source of truth). Internal layer contracts stay plain TS interfaces.
- **Config** via `src/infra/config.ts` only (the single reader of `process.env`): `.env` + `.env.local` (both git-ignored) + committed `.env.example`; runs with no env files thanks to defaults.
- **Logging** via **pino**; workflows must log through `@temporalio/workflow`'s `log` (sinks), never pino directly (determinism).
- **Boundary rules** (also intended as ESLint `no-restricted-imports`): `application` ↛ `infra`; `domain` imports no framework; `contracts.ts` is the sole owner of signal/query names; activity adapters `satisfies AiToolsActivities`.
- **Testing (three tiers):** _smoke_ = manual `curl` checklist (not automated); _unit_ = colocated `*.test.ts` beside the source, collaborators mocked (Vitest + `@temporalio/testing` time-skipping for the workflow); _feature/e2e_ = `features/` at repo root, everything wired for real. Scripts: `test` (all), `test:unit` (`vitest run src`), `test:feature` (`vitest run features`). All automated tiers are self-contained (own test server) — no external cluster/worker needed. Prefer running a single test file while iterating.
- **All `@temporalio/*` packages must share one identical version.**
- **Git:** Conventional Commits (commitlint via husky `commit-msg`); husky `pre-commit` runs `format:check` + `lint` + `build`.

## Working with Temporal

The `temporal@temporal-marketplace` plugin is enabled (`.claude/settings.json`), providing the `temporal:temporal-developer` skill — use it for SDK authoring, determinism/non-determinism errors, versioning, and CLI. Use the project's own **`temporal-agent-ops`** skill for running/operating _this_ app. For library/API docs (Temporal, Fastify, Zod), prefer the **context7** MCP server over guessing.

## Repo tooling

- **MCP servers** (`.mcp.json`): `context7` only.
- **Slash commands** (`.claude/commands/`): `/verify` (fits), `/review` and `/test-coverage` (inherited from a prior demo — still worded for Express/Jest; adapt before relying on them).
- **Permissions/hooks** (`.claude/settings.json`, `settings.local.json`): npm scripts + read-only/commit git commands allowed; destructive commands denied. A `Stop` desktop-notification hook is set locally. No `PostToolUse` formatting hook — formatting is handled by the husky `pre-commit`.
