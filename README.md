# temporal-claude

A small **human-in-the-loop AI agent** built on [Temporal](https://temporal.io) (TypeScript).
A workflow plans a task, **waits for a human to approve the plan**, executes the approved
steps, and synthesizes a result. The "AI" is **mocked** (deterministic, offline, no API
keys) — the point is durable, human-in-the-loop orchestration, not real inference.

```
plan ──▶ AWAIT human approval ──▶ execute steps ──▶ synthesize ──▶ done
             │  (reject → re-plan, up to 3×)
             └─ cancel ends the run from any wait point
```

## Architecture

Layered / DDD — dependencies point **inward only** (`domain` is framework-free):

```
src/
├── domain/         # the model: types only (Plan, StepResult, AgentState, …)
├── application/    # orchestration: agentWorkflow + AgentRun + contracts/ (signals/queries) + ports.ts
├── infra/          # config, logger (pino), temporal connection, mocked AI activities, worker
└── interfaces/     # driving adapters: cli/ (start-only client) + http/ (Fastify REST API)
```

Key idea: **the workflow runs inside the worker**, not a container of its own. The `temporal`
server is the cluster (orchestration + durable history + Web UI). The CLI, the REST API, and
the Web UI are all just _clients_ that start/signal/query workflows. The workflow depends on
the `AiToolsActivities` **port**; the mocked implementation lives in `infra/activities` — swap
it for a real LLM call without touching the workflow.

## Prerequisites

- **Node 26** (see `.nvmrc`: `nvm use`)
- Either **Docker** (for the compose stack) or the **Temporal CLI**
  (`brew install temporal`) for bare-metal runs

```bash
npm install
```

## Run it — Docker (one command)

```bash
docker compose up                    # temporal (server + Web UI) + worker + api
docker compose run --rm client       # start one workflow, print its id, then exit
```

- Web UI: <http://localhost:8233> · REST API: <http://localhost:3000>

## Run it — bare metal

Three terminals:

```bash
temporal server start-dev            # 1. cluster + Web UI (:7233 / :8233)
npm run worker                       # 2. worker — hosts the workflow + activities
npm run api                          # 3. Fastify REST API on :3000
# or start a workflow directly:
npm run start -- "your topic here"   #    CLI client (start-only)
```

## Human-in-the-loop: approving a plan

After a workflow starts it **blocks awaiting approval**. Approve it three ways:

**REST API**

```bash
# start
curl -sX POST localhost:3000/agents -H 'content-type: application/json' \
     -d '{"topic":"temporal vs cron"}'          # → 201 { "data": { "workflowId": "agent-…" } }
# inspect the plan
curl -s localhost:3000/agents/<id>               # → 200 { "data": <AgentState> }
# approve (or reject with feedback)
curl -sX POST localhost:3000/agents/<id>/approve -H 'content-type: application/json' \
     -d '{"approved":true}'                       # → 202
# other signals
curl -sX POST localhost:3000/agents/<id>/guidance -H 'content-type: application/json' \
     -d '{"guidance":"prefer recent sources"}'    # → 202
curl -sX POST localhost:3000/agents/<id>/cancel   # → 202
```

**Temporal CLI**

```bash
temporal workflow query  -w <id> --type getState
temporal workflow signal -w <id> --name approvePlan --input '{"approved":true}'
```

**Web UI** — open <http://localhost:8233>, find the workflow, inspect its history, and send
the `approvePlan` signal / `getState` query.

## Configuration

All config flows through `src/infra/config` (the only reader of `process.env`), zod-validated
into a frozen `AppConfig`. Precedence: real env → `.env.local` → `.env` → built-in defaults —
so it **runs with no env files at all**. Copy `.env.example` to `.env` to customize.

| Variable                  | Default            | Purpose                                              |
| ------------------------- | ------------------ | ---------------------------------------------------- |
| `TEMPORAL_ADDRESS`        | `localhost:7233`   | Temporal gRPC endpoint                               |
| `TEMPORAL_NAMESPACE`      | `default`          | namespace                                            |
| `TEMPORAL_API_KEY`        | —                  | set in `.env.local` for Temporal Cloud (enables TLS) |
| `HTTP_PORT` / `HTTP_HOST` | `3000` / `0.0.0.0` | REST API bind                                        |
| `CORS_ORIGIN`             | `*`                | allowed CORS origin                                  |
| `LOG_LEVEL`               | `info`             | pino level                                           |
| `NODE_ENV`                | `development`      | `production` → JSON logs                             |

The task queue is a code constant (`TASK_QUEUE`), not config. Dev → Temporal Cloud is a
config change (address + `TEMPORAL_API_KEY`), not a code change.

## Testing

```bash
npm test            # all: unit + endpoint e2e (self-contained; boots its own test server)
npm run test:unit   # colocated unit/component tests
npm run test:feature # endpoint e2e (features/)
```

The workflow test uses Temporal's time-skipping `TestWorkflowEnvironment`; the HTTP layer is
covered by a real endpoint e2e (`features/http-api.feature.test.ts`) rather than unit tests.
No dev server or worker needed.

## Scripts

| script                                               | purpose                                          |
| ---------------------------------------------------- | ------------------------------------------------ |
| `worker` / `api` / `start`                           | run the worker / REST API / CLI client (via tsx) |
| `build`                                              | strict typecheck (`tsc --noEmit`)                |
| `lint` / `lint:fix`                                  | ESLint                                           |
| `format` / `format:check`                            | Prettier                                         |
| `test` / `test:unit` / `test:feature` / `test:watch` | Vitest                                           |

## Tooling

Strict TypeScript (`@tsconfig/strictest`), ESLint (type-aware + enforced layer boundaries),
Prettier, Vitest, zod (edge validation), pino (logging), Fastify (API), husky + commitlint
(Conventional Commits). See `docs/{PLAN,SPEC,TASKS}.md` for the design and build history.
