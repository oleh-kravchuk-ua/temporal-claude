# Implementation Plan — Temporal AI-Agent demo

> Living document. We expect to adjust this as we build. See [`SPEC.md`](./SPEC.md) for
> the behavioral contract.

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
| AI backend    | **Mocked** (pure functions in `activities/`), offline                                                                                                                          |
| Codebase      | **Single package**, flat Temporal-idiomatic layout, three entrypoints (worker, api, client)                                                                                    |
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
| Principles    | Clean / **SOLID** / **DRY** / **KISS** — see [`SPEC.md` §Principles](./SPEC.md) for the concrete rules                                                                         |

## Architecture (flat, Temporal-idiomatic)

The workflow depends only on the `AiToolsActivities` port; everything else depends on the
workflow's contracts/model, never the reverse.

```
src/
├── workflow/                   # orchestration + model — MUST NOT import infra/activities/http/cli
│   ├── types.ts                #   the model: types/interfaces only (no logic)
│   ├── ports.ts                #   AiToolsActivities port (the workflow's dependency contract,
│   │                           #     and the Strategy interface activities/ implementations satisfy)
│   ├── contracts.ts            #   signals/queries + payload schemas: agent-input, agent-result,
│   │                           #     approve-plan, provide-guidance, cancel, get-state
│   ├── agent-run.ts            #   AgentRun — run state + phase pipeline (activities injected)
│   └── agent.workflow.ts       #   agentWorkflow — wires signals/queries to AgentRun, proxies activities
├── activities/                 # AiToolsActivities strategies (grows: mock today, Claude later)
│   ├── mock-ai-tools.ts        #   mocked impl `satisfies AiToolsActivities` (real = LLM I/O)
│   └── index.ts                #   Strategy selection point the worker calls
├── infra/                      # cross-cutting plumbing only
│   ├── config/                 #   AppConfig (grouped by concern) — index/load/read-env/types
│   ├── temporal/                #   NativeConnection (worker) + Client connection (api/cli)
│   ├── logger.ts               #   shared pino instance from AppConfig.logLevel
│   └── process-errors.ts       #   unhandledRejection/uncaughtException → log + exit
├── worker.ts                   #   entrypoint: Worker.create + run  ← workflows + activities execute HERE
├── http/                       # driving adapter: Fastify REST API (a Temporal client)
│   ├── app.ts                  #   buildApp factory (helmet, cors, error handler, routes)
│   ├── server.ts               #   entrypoint: buildApp + config + connection + listen
│   ├── error-handler.ts        #   { error } envelope + status mapping
│   ├── routes/agents.ts        #   /agents endpoints → start/query/signal via Temporal Client
│   └── schemas.ts              #   zod request schemas (reuse contracts where possible)
└── cli/
    └── client.ts               #   start-only: starts a workflow, prints its id, exits

# Unit tests are COLOCATED next to their target (*.test.ts):
#   src/activities/mock-ai-tools.test.ts · src/infra/config/config.test.ts
#   src/workflow/agent.workflow.test.ts · src/http/routes/agents.test.ts

features/                       # feature / e2e tests — everything wired for real
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
port defined in `workflow/ports.ts`, so `workflow` never imports `activities`/`infra`. The
mocked implementation (`activities/mock-ai-tools.ts`) satisfies the port; today it's
mocked/deterministic, tomorrow it's an LLM call — selected at `activities/index.ts` (the
Strategy seam) without the workflow ever knowing which one it got. `workflow/types.ts` holds
only the model (types) that every layer speaks.

**Where the workflow runs:** there is no "workflow container." Workflow code is hosted by
the **worker**, which runs both workflow and activity functions. The `temporal` container
is the cluster (orchestration + durable history + Web UI). Clients (the CLI, the **HTTP
API**, the Web UI) only _start/poke_ workflows via a Temporal Client — they never host
workflow code.

**Three ways to drive HITL:** Temporal Web UI (`:8233`), Temporal CLI, and our **Fastify
REST API** (`:3000`). All three are clients issuing the same signals/queries defined in
`workflow/contracts.ts`.

## Configuration

Single typed config module (`src/infra/config`) is the only reader of `process.env`;
the rest of the code depends on a typed `AppConfig` (DIP + DRY).

- **`.env`** — local base config (git-ignored). **`.env.local`** — machine/secret overrides
  (git-ignored), e.g. Temporal Cloud address + API key. **`.env.example`** — committed
  template documenting every variable.
- **Precedence (highest → lowest):** real `process.env` → `.env.local` → `.env` →
  built-in defaults. The app runs with **no env files at all** thanks to the defaults.
- Variables: `TEMPORAL_ADDRESS` (default `localhost:7233`), `TEMPORAL_NAMESPACE`
  (`default`), `TEMPORAL_TASK_QUEUE` (`ai-agent`), `LOG_LEVEL` (`info`), `NODE_ENV`
  (`development`), `HTTP_PORT` (`3000`), `HTTP_HOST` (`0.0.0.0`), `CORS_ORIGIN` (`*`),
  `TEMPORAL_API_KEY` (optional, Cloud). Flat env vars map to the grouped `AppConfig`
  (`http.*`, `temporal.connection.*`, `temporal.taskQueue`).
- Compose loads `.env`/`.env.local` into each app service via `env_file` (both optional), then
  overrides the network-specific vars in `environment:` (`TEMPORAL_ADDRESS=temporal:7233` — the
  service DNS, not localhost). `environment:` wins over `env_file`.

## Run model

- **Bare metal:** `temporal server start-dev` → `npm run worker` → (`npm run api` and/or
  `npm run start`) → approve via Web UI (`:8233`), CLI, or REST API (`:3000`).
- **Docker:** `docker compose up` (temporal + worker + api) → start a run via
  `POST :3000/agents`, `docker compose run --rm client`, or CLI → approve via UI/CLI/API.

Dev → Temporal Cloud is a config swap (env vars via `infra/temporal/index.ts`), not a code
change.

## Tooling / scripts

| script         | command                  | purpose                                    |
| -------------- | ------------------------ | ------------------------------------------ |
| `worker`       | `tsx src/worker.ts`      | run the worker (long-lived)                |
| `api`          | `tsx src/http/server.ts` | run the Fastify HITL REST API (long-lived) |
| `start`        | `tsx src/cli/client.ts`  | start a workflow, print id, exit           |
| `build`        | `tsc --noEmit`           | strict typecheck (run via tsx; no emit)    |
| `lint`         | `eslint .`               | ESLint flat config                         |
| `lint:fix`     | `eslint . --fix`         | lint and auto-fix                          |
| `format`       | `prettier --write .`     | format the codebase                        |
| `format:check` | `prettier --check .`     | verify formatting (CI / pre-commit)        |
| `test`         | `vitest run`             | all tests (unit + feature)                 |
| `test:unit`    | `vitest run src`         | colocated unit tests only                  |
| `test:feature` | `vitest run features`    | feature / e2e tests only                   |
| `test:watch`   | `vitest`                 | watch mode                                 |
| `prepare`      | `husky`                  | install git hooks (runs on `npm install`)  |

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

One `Dockerfile` (multi-stage, `node:26-slim`); `worker`, `api`, and `client` are the
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
