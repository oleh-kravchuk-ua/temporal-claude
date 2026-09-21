---
name: temporal-agent-ops
description: Run and interact with THIS project's human-in-the-loop Temporal AI-agent app. Use when starting/demoing/debugging the app's execution or HITL flow — running the dev server, worker, HTTP API, or CLI client; approving/rejecting a plan via signals/queries (Web UI, CLI, or REST); Docker Compose; config/.env; or project-specific gotchas. For general Temporal SDK authoring/determinism/versioning, use temporal:temporal-developer instead.
---

# Temporal Agent Ops

## Purpose

How to **run and interact with this specific app** — the human-in-the-loop AI-agent
workflow. This is the operational runbook for our project. For general Temporal SDK
know-how (workflow authoring, determinism, versioning, CLI reference), defer to the
`temporal:temporal-developer` plugin skill — this file does **not** duplicate it.

See [`docs/SPEC.md`](../../../docs/SPEC.md) for the behavioral contract (signals, queries,
state machine) and [`docs/PLAN.md`](../../../docs/PLAN.md) for architecture.

## Mental model (read this first)

- The **workflow runs inside the worker**, not in a container of its own.
- The **`temporal` server** is the cluster: it orchestrates and stores durable history,
  and serves the Web UI on `:8233` (gRPC on `:7233`).
- A **client** (`npm run start`, the **HTTP API**, the CLI, or the Web UI) only _starts or
  pokes_ workflows, then exits/returns. The workflow keeps running on the worker regardless.
- The **HTTP API** (`npm run api`, Fastify on `:3000`) is a Temporal _client_ too — it hosts
  no workflow code; it just maps REST calls to signals/queries.
- After start, the agent **blocks awaiting a human `approvePlan` signal**. Nothing
  finishes until a human approves (via API, CLI, or UI).

## Running — bare metal (fast inner loop)

Three processes, started in this order:

```bash
temporal server start-dev        # 1. cluster + Web UI (:7233 / :8233)
npm run worker                   # 2. worker — hosts workflow + activities
npm run api                      # 3. (optional) Fastify HITL REST API on :3000
npm run start                    # or: CLI client — starts one workflow, prints id, exits
```

If you skip step 2, the workflow is created but sits in `Running` making no progress until
a worker polls the `ai-agent` task queue.

## Running — Docker Compose (closer to deployed)

```bash
docker compose up                     # temporal + worker + api come up
docker compose run --rm client        # start one workflow (prints its id), then exits
# or start via the API: curl -sX POST localhost:3000/agents -d '{"topic":"…"}' -H 'content-type: application/json'
```

`worker`, `api`, and `client` are the **same image, different command**. The Web UI is at
`http://localhost:8233`; the REST API at `http://localhost:3000`.

## Human-in-the-loop: approving a plan

After starting, grab the workflow id from the client output. Then either:

**Web UI** — open `http://localhost:8233`, find the workflow, inspect the plan in its
history, and send the signal/query from the UI.

**CLI** (against `localhost:7233`, or via `docker compose exec temporal temporal …`):

```bash
# See the current plan / status (read-only query)
temporal workflow query   -w <workflow-id> --type getState

# Approve the plan → execution proceeds
temporal workflow signal  -w <workflow-id> --name approvePlan   --input '{"approved":true}'

# Reject with feedback → re-plans (up to MAX_REJECTIONS)
temporal workflow signal  -w <workflow-id> --name approvePlan   --input '{"approved":false,"feedback":"go deeper on X"}'

# Add guidance used during execution
temporal workflow signal  -w <workflow-id> --name provideGuidance --input '"prefer recent sources"'

# Cancel gracefully (ends as 'cancelled')
temporal workflow signal  -w <workflow-id> --name cancel
```

**HTTP API** (Fastify on `:3000`) — same actions over REST:

```bash
curl -sX POST localhost:3000/agents -H 'content-type: application/json' \
     -d '{"topic":"temporal vs cron"}'                 # → 201 { data: { workflowId } }
curl -s      localhost:3000/agents/<id>                 # → 200 { data: AgentState }
curl -sX POST localhost:3000/agents/<id>/approve -H 'content-type: application/json' \
     -d '{"approved":true}'                             # → 202
curl -sX POST localhost:3000/agents/<id>/guidance -H 'content-type: application/json' \
     -d '{"guidance":"prefer recent sources"}'          # → 202
curl -sX POST localhost:3000/agents/<id>/cancel         # → 202
curl -s      localhost:3000/healthz                     # → 200 { data: { status: "ok" } }
```

Signal/query names and payload shapes are defined in `src/application/contracts.ts`, and
the REST surface in `src/interfaces/http` — keep this runbook in sync with those files.

## Testing (three tiers — no external server/worker needed)

```bash
npm test              # everything (unit + feature)
npm run test:unit     # colocated *.test.ts in src/ — collaborators mocked, fast
npm run test:feature  # features/ — real worker + activities + Fastify app + client, e2e
npm run build         # strict typecheck (@tsconfig/strictest)
npm run lint          # ESLint v9
```

All automated tiers use `TestWorkflowEnvironment` (their own in-process server) — do **not**
start `start-dev` or a worker to run them. The **smoke** tier is the manual `curl` checklist
below, run against a live stack.

## Configuration

All config flows through `src/infra/config.ts` (the only reader of `process.env`),
zod-validated into a typed `AppConfig`.

- `.env` — local base (git-ignored). `.env.local` — machine/secret overrides (git-ignored).
  `.env.example` — committed template; copy it to get started: `cp .env.example .env`.
- Precedence: real env → `.env.local` → `.env` → built-in defaults. **Runs with no env
  files** (defaults: `localhost:7233`, namespace `default`, task queue `ai-agent`).
- Vars: `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_TASK_QUEUE`, `LOG_LEVEL`,
  `HTTP_PORT` (3000), `HTTP_HOST` (0.0.0.0), `CORS_ORIGIN` (*), `TEMPORAL_API_KEY`
  (Cloud, via `.env.local`).
- Logging is structured **pino** at `LOG_LEVEL` (`pino-pretty` in dev). Workflows log via
  the SDK's `log`, never pino directly (determinism).

## Dev → Temporal Cloud

Moving off the local dev server is a **config change, not a code change**: set the Cloud
address, namespace, and `TEMPORAL_API_KEY` in `.env.local`. Worker and client code stay
identical.

## Common gotchas (project-specific)

- **Nothing completes after `start`** — that's expected; the agent is awaiting
  `approvePlan`. Send the signal.
- **Workflow stuck in `Running`, no history advancing** — no worker is polling
  `ai-agent`. Start `npm run worker`.
- **Version mismatch errors** — all `@temporalio/*` packages must be the exact same
  version.
- **Non-determinism error after editing the workflow** — you changed workflow logic while
  an execution was mid-flight; start a fresh execution, or see the plugin skill on
  versioning/patching.
- **CLI can't connect** — confirm the dev server is up and you're targeting
  `localhost:7233` (bare metal) or exec'ing into the `temporal` container (Docker).

## When to apply

- Running, demoing, or debugging _this_ app's execution and HITL flow.
- Writing docs/scripts about how to operate it.

For authoring new workflows/activities, determinism questions, or CLI details beyond the
above, use `temporal:temporal-developer`.
