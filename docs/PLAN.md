# Implementation Plan — Temporal AI-Agent demo

> Living document. We expect to adjust this as we build. See [`SPEC.md`](./SPEC.md) for
> the behavioral contract and [`TASKS.md`](./TASKS.md) for the checkboxed breakdown.

## Goal

A minimal, offline-runnable **human-in-the-loop AI agent** built on Temporal (TypeScript
SDK). The agent plans a task, **waits for a human to approve the plan**, executes the
approved steps, then synthesizes a final answer. All "AI" work is **mocked** — no API
keys, no network — so the focus stays on Temporal orchestration and durable execution.

The human approves via Temporal's own **Web UI** and/or **CLI**; we do not build a
frontend.

## Decisions (locked)

| Area          | Decision                                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SDK           | Temporal **TypeScript** SDK (matches this ES-module repo)                                                                                                                      |
| App shape     | Multi-step agent with **signals + queries** (human-in-the-loop)                                                                                                                |
| AI backend    | **Mocked** (pure functions in `domain/`), offline                                                                                                                              |
| Codebase      | **Single package**, DDD layers as folders, two entrypoints (worker, client)                                                                                                    |
| TypeScript    | `strict` via **`@tsconfig/strictest`**, `moduleResolution: Bundler`, ESNext                                                                                                    |
| Lint          | **ESLint v9** flat config + `typescript-eslint` (type-aware)                                                                                                                   |
| Format        | **Prettier** — sole formatter; `eslint-config-prettier` disables ESLint's formatting rules so the two don't fight                                                              |
| Tests         | **Vitest** + `@temporalio/testing` (time-skipping, mocked activities)                                                                                                          |
| Local cluster | **`temporal server start-dev`** (single dev-server, in-memory)                                                                                                                 |
| Docker        | Compose: single **start-dev** container + our **worker** + one-shot **client**                                                                                                 |
| Config        | **`.env` + `.env.local`** (both git-ignored) + committed `.env.example`; loaded once in a typed config module with built-in defaults                                           |
| Validation    | **Zod at the edges** — env, workflow input, signal payloads, HTTP requests schema-validated; types inferred from schemas. Internal layer contracts stay plain TS interfaces    |
| HTTP API      | **Fastify** driving adapter (a Temporal _client_) exposing a full HITL REST API; `@fastify/cors` + `@fastify/helmet`; zod request validation                                   |
| Logging       | **pino** (structured). Fastify uses it natively; worker/activities/CLI use a shared pino instance. Workflows log via `@temporalio/workflow` `log` (sinks), never pino directly |
| HTTP client   | Node built-in **`undici`** (global `fetch`) — no dependency; available to activities if a tool ever makes a real call                                                          |
| Git hooks     | **husky** — `commit-msg` → **commitlint** (`@commitlint/config-conventional`); `pre-commit` → `lint` + `build` (typecheck)                                                     |
| Principles    | Clean / **SOLID** / **DDD** / **DRY** / **KISS** — see [`SPEC.md` §Principles](./SPEC.md) for the concrete rules                                                               |

## Architecture (layered DDD)

Dependencies point **inward**; `domain` has zero framework imports.

```
src/
├── domain/                     # pure business logic — NO @temporalio imports
│   ├── agent.ts                #   types + mocked-AI pure functions
│   └── ports.ts                #   AiToolsActivities port (what the core needs)
├── application/                # orchestration = workflows
│   ├── contracts.ts            #   TASK_QUEUE + signal/query definitions
│   └── agent.workflow.ts       #   agentWorkflow (proxies the port, handles signals/queries)
├── infra/                      # Temporal basics + adapters
│   ├── activities/ai-tools.ts  #   implements the port → delegates to domain
│   ├── config.ts               #   loads .env/.env.local, zod-validates → typed AppConfig
│   ├── connection.ts           #   NativeConnection (worker) + Client connection (api/cli)
│   ├── logger.ts               #   shared pino instance from AppConfig.logLevel
│   └── worker.ts               #   Worker.create + run  ← workflows + activities execute HERE
└── interfaces/                 # driving adapters (all depend only on application + infra client)
    ├── cli/
    │   └── client.ts           #   start-only: starts a workflow, prints its id, exits
    └── http/
        ├── server.ts           #   Fastify bootstrap: pino, @fastify/cors, @fastify/helmet, Client
        ├── routes/agents.ts    #   /agents endpoints → start/query/signal via Temporal Client
        └── schemas.ts          #   zod request/response schemas (reuse contracts where possible)

# Unit tests are COLOCATED next to their target (*.test.ts):
#   src/domain/agent.test.ts · src/infra/config.test.ts
#   src/application/agent.workflow.test.ts · src/interfaces/http/routes/agents.test.ts

features/                       # feature / e2e tests — everything wired for real
├── agent-lifecycle.feature.test.ts   # real worker + real activities, full HITL happy path
└── http-api.feature.test.ts          # real Fastify app → real client → real worker
```

## Testing strategy (three tiers)

- **Smoke — manual `curl`.** Not automated; a documented checklist against a live stack
  (`start-dev` + `worker` + `api`). See the `temporal-agent-ops` skill / README.
- **Unit — colocated** (`*.test.ts` beside the source), collaborators **mocked**, fast and
  isolated. Includes the workflow's state-machine test (`TestWorkflowEnvironment` + mocked
  activities).
- **Feature (e2e) — `features/`** at repo root, **everything real** (worker, activities,
  Fastify app, client) driven through the user-facing entrypoints.

**Ports & adapters:** the workflow calls `proxyActivities<AiToolsActivities>()` against the
port defined in `domain/ports.ts`, so `application` never imports `infra`. The infra
adapter implements the port and delegates the mocked reasoning to `domain/agent.ts`.

**Where the workflow runs:** there is no "workflow container." Workflow code is hosted by
the **worker**, which runs both workflow and activity functions. The `temporal` container
is the cluster (orchestration + durable history + Web UI). Clients (the CLI, the **HTTP
API**, the Web UI) only _start/poke_ workflows via a Temporal Client — they never host
workflow code.

**Three ways to drive HITL:** Temporal Web UI (`:8233`), Temporal CLI, and our **Fastify
REST API** (`:3000`). All three are clients issuing the same signals/queries defined in
`application/contracts.ts`.

## Configuration

Single typed config module (`src/infra/config.ts`) is the only reader of `process.env`;
the rest of the code depends on a typed `AppConfig` (DIP + DRY).

- **`.env`** — local base config (git-ignored). **`.env.local`** — machine/secret overrides
  (git-ignored), e.g. Temporal Cloud address + API key. **`.env.example`** — committed
  template documenting every variable.
- **Precedence (highest → lowest):** real `process.env` → `.env.local` → `.env` →
  built-in defaults. The app runs with **no env files at all** thanks to the defaults.
- Variables: `TEMPORAL_ADDRESS` (default `localhost:7233`), `TEMPORAL_NAMESPACE`
  (`default`), `TEMPORAL_TASK_QUEUE` (`ai-agent`), `LOG_LEVEL` (`info`), `HTTP_PORT`
  (`3000`), `HTTP_HOST` (`0.0.0.0`), `CORS_ORIGIN` (`*`), `TEMPORAL_API_KEY` (optional, Cloud).
- Compose passes env explicitly per service (worker/api/client get `TEMPORAL_ADDRESS=temporal:7233`).

## Run model

- **Bare metal:** `temporal server start-dev` → `npm run worker` → (`npm run api` and/or
  `npm run start`) → approve via Web UI (`:8233`), CLI, or REST API (`:3000`).
- **Docker:** `docker compose up` (temporal + worker + api) → start a run via
  `POST :3000/agents`, `docker compose run --rm client`, or CLI → approve via UI/CLI/API.

Dev → Temporal Cloud is a config swap (env vars via `infra/connection.ts`), not a code
change.

## Tooling / scripts

| script         | command                             | purpose                                    |
| -------------- | ----------------------------------- | ------------------------------------------ |
| `worker`       | `tsx src/infra/worker.ts`           | run the worker (long-lived)                |
| `api`          | `tsx src/interfaces/http/server.ts` | run the Fastify HITL REST API (long-lived) |
| `start`        | `tsx src/interfaces/cli/client.ts`  | start a workflow, print id, exit           |
| `build`        | `tsc`                               | strict typecheck / emit to `dist/`         |
| `lint`         | `eslint .`                          | ESLint v9 flat config                      |
| `format`       | `prettier --write .`                | format the codebase                        |
| `format:check` | `prettier --check .`                | verify formatting (CI / pre-commit)        |
| `test`         | `vitest run`                        | all tests (unit + feature)                 |
| `test:unit`    | `vitest run src`                    | colocated unit tests only                  |
| `test:feature` | `vitest run features`               | feature / e2e tests only                   |
| `test:watch`   | `vitest`                            | watch mode                                 |
| `prepare`      | `husky`                             | install git hooks (runs on `npm install`)  |

Runtime deps to add: `zod` (boundary validation), `fastify @fastify/cors @fastify/helmet
pino` (API + logging). `undici` is **not** added — it's Node's built-in `fetch`. Dev deps
to add: `typescript tsx @types/node vitest @temporalio/testing @tsconfig/strictest eslint
@eslint/js typescript-eslint prettier eslint-config-prettier husky @commitlint/cli
@commitlint/config-conventional pino-pretty` (runtime `@temporalio/*` already installed).

## Files this adds (beyond `src/` + `features/`)

`tsconfig.json` · `eslint.config.js` · `.prettierrc` · `.prettierignore` ·
`vitest.config.ts` · `commitlint.config.js` · `.husky/commit-msg` · `.husky/pre-commit` ·
`.env.example` · `Dockerfile` · `.dockerignore` · `docker-compose.yml`, plus updates to
`package.json`, `README.md`, and `CLAUDE.md`.
(`.env` / `.env.local` are local, git-ignored — created from `.env.example`.)

## Docker Compose services

One `Dockerfile` (multi-stage, `node:22-slim`); `worker`, `api`, and `client` are the
**same image, different `command:`**.

| service    | command                                  | kind                                    | ports      |
| ---------- | ---------------------------------------- | --------------------------------------- | ---------- |
| `temporal` | `temporal server start-dev --ip 0.0.0.0` | long-lived (cluster + UI)               | 7233, 8233 |
| `worker`   | `worker`                                 | long-lived (hosts workflows+activities) | —          |
| `api`      | `api`                                    | long-lived (Fastify REST)               | 3000       |
| `client`   | `start`                                  | one-shot (`profiles: [tools]`)          | —          |

`worker`/`api` `depends_on: temporal` (healthy). We do **not** build a frontend — the API
is a programmatic interface; the human UI is Temporal's own Web UI.

## Scope guardrails

One workflow, three mocked activities, in-memory only, single task queue. **No** child
workflows, continue-as-new, real LLM, database, or web frontend. The HTTP API is a thin
Temporal-client adapter (start/query/signal) — no business logic lives in it.

## Open questions / likely adjustments

- Whether to demonstrate an activity **retry** (e.g., a mock transient failure) or keep
  activities deterministic-happy for the first cut.
- Whether the client stays strictly start-only or also prints a ready-to-paste
  `temporal workflow signal` command for convenience.
- Docker base image / `@temporalio/core-bridge` prebuild verification at build time.
- Verify Node's `process.loadEnvFile` overwrite behavior on Node 26 and load order so the
  documented precedence (real env → `.env.local` → `.env` → defaults) holds exactly.
