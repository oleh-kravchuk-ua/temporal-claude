# Specification — Temporal AI-Agent workflow

> The behavioral contract the implementation must satisfy. Detailed enough to build and
> test against. Companion to [`PLAN.md`](./PLAN.md) and [`TASKS.md`](./TASKS.md).

## 1. Overview

`agentWorkflow` orchestrates a mocked "AI agent" that completes a research-style task in
four phases, pausing for a human between planning and execution:

```
plan ──▶ AWAIT human approval ──▶ execute steps ──▶ synthesize ──▶ done
             │  (reject → re-plan loop)
             └──────────────────────┐
   cancel signal ends the run from any waiting/executing point
```

All reasoning is **mocked** and lives in `domain/agent.ts` as pure, deterministic
functions invoked _inside activities_. The workflow itself contains only orchestration.

## 2. Domain model (`src/domain/agent.ts`)

```ts
export type ToolName = 'search' | 'summarize' | 'draft';

export interface PlanStep {
  id: number; // 1-based, stable within a plan
  description: string;
  tool: ToolName;
}

export interface Plan {
  topic: string;
  steps: PlanStep[]; // non-empty
}

export interface StepResult {
  stepId: number;
  output: string;
}

export type AgentStatus =
  | 'planning'
  | 'awaiting_approval'
  | 'executing'
  | 'synthesizing'
  | 'completed'
  | 'rejected' // terminal: too many rejections (see §6)
  | 'cancelled'; // terminal: cancel signal received

export interface AgentState {
  status: AgentStatus;
  topic: string;
  revision: number; // increments each (re)plan; starts at 1
  plan?: Plan; // set once planned
  currentStepId?: number; // set during 'executing'
  results: StepResult[];
  guidance: string[]; // accumulated mid-run guidance
  finalAnswer?: string; // set on 'completed'
}
```

**Pure domain functions** (no Temporal, no I/O, deterministic):

```ts
planTask(topic: string, feedback?: string): Plan
runTool(step: PlanStep, guidance: string[]): StepResult
synthesize(topic: string, results: StepResult[]): string
```

These are what the mocked activities call. Being pure, they are unit-testable with zero
Temporal machinery.

## 3. Workflow I/O (`src/application/agent.workflow.ts`)

```ts
export interface AgentInput {
  topic: string;
}

export interface AgentResult {
  status: 'completed' | 'rejected' | 'cancelled';
  finalAnswer?: string; // present iff status === 'completed'
  revision: number;
  stepCount: number;
}

export async function agentWorkflow(input: AgentInput): Promise<AgentResult>;
```

## 4. Contracts (`src/application/contracts.ts`)

Shared by the workflow and any client (our `client.ts`, the CLI, the Web UI).

```ts
export const TASK_QUEUE = 'ai-agent';

// Signals
export const approvePlan = defineSignal<[ApprovePlanInput]>('approvePlan');
export const provideGuidance = defineSignal<[string]>('provideGuidance');
export const cancelAgent = defineSignal<[]>('cancel');

// Query
export const getState = defineQuery<AgentState>('getState');

export interface ApprovePlanInput {
  approved: boolean;
  feedback?: string; // used when approved === false to steer re-planning
}
```

### Signal semantics

| Signal            | Payload                   | Effect                                                                                                                                                                 |
| ----------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `approvePlan`     | `{ approved, feedback? }` | `approved: true` → proceed to execute. `approved: false` → re-plan with `feedback` (revision++), stay awaiting approval. Ignored unless status is `awaiting_approval`. |
| `provideGuidance` | `string`                  | Append to `guidance`; applied to subsequent `runTool` calls. Accepted anytime before completion.                                                                       |
| `cancel`          | —                         | Request graceful stop; workflow ends `cancelled` at the next safe point.                                                                                               |

### Query semantics

| Query      | Returns               | Rule                                                    |
| ---------- | --------------------- | ------------------------------------------------------- |
| `getState` | `AgentState` snapshot | **Read-only.** Must not mutate state or run activities. |

## 5. Activity port & adapter

**Port** (`src/domain/ports.ts`) — the dependency the core declares:

```ts
export interface AiToolsActivities {
  planTask(topic: string, feedback?: string): Promise<Plan>;
  runTool(step: PlanStep, guidance: string[]): Promise<StepResult>;
  synthesize(topic: string, results: StepResult[]): Promise<string>;
}
```

**Adapter** (`src/infra/activities/ai-tools.ts`) implements the port by delegating to the
pure domain functions (this is the only place the mocked "latency"/side-effect-shaped code
lives).

**Proxy options** (in the workflow):

```ts
const acts = proxyActivities<AiToolsActivities>({
  startToCloseTimeout: '1 minute',
  retry: { initialInterval: '1s', maximumAttempts: 3 },
});
```

## 6. Workflow state machine

Initial: `{ status: 'planning', topic, revision: 1, results: [], guidance: [] }`.

1. **planning** → `plan = await planTask(topic)` → set `plan`, `status = 'awaiting_approval'`.
2. **awaiting_approval** → `await condition(() => approvalDecision !== undefined || cancelled)`.
   - `cancel` → `status = 'cancelled'` → return.
   - `approvePlan(false, feedback)` → `status = 'planning'`, `revision++`,
     `plan = await planTask(topic, feedback)` → back to `awaiting_approval`.
     After **MAX_REJECTIONS = 3** rejections → `status = 'rejected'` → return.
   - `approvePlan(true)` → `status = 'executing'`.
3. **executing** → for each `step` of `plan.steps` (in order):
   - if `cancelled` → `status = 'cancelled'` → return.
   - `currentStepId = step.id`; `result = await runTool(step, guidance)`; push to `results`.
4. **synthesizing** → `finalAnswer = await synthesize(topic, results)`.
5. **completed** → `status = 'completed'` → return
   `{ status, finalAnswer, revision, stepCount: results.length }`.

Terminal states: `completed`, `rejected`, `cancelled`.

## 6a. Configuration contract (`src/infra/config.ts`)

The **only** module that reads `process.env`. Loads `.env` then `.env.local` (local
overrides base), then zod-validates into a typed, frozen `AppConfig`. Everything else
depends on `AppConfig`, never on `process.env` (DIP + DRY).

```ts
// schema is the single source of truth; the type is inferred from it
export const AppConfigSchema = z.object({
  temporalAddress: z.string().min(1).default('localhost:7233'),
  temporalNamespace: z.string().min(1).default('default'),
  taskQueue: z.string().min(1).default('ai-agent'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  httpPort: z.coerce.number().int().positive().default(3000),
  httpHost: z.string().min(1).default('0.0.0.0'),
  corsOrigin: z.string().min(1).default('*'),
  temporalApiKey: z.string().min(1).optional(), // set via .env.local for Cloud
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

export function loadConfig(): AppConfig; // throws a clear error on invalid env
```

**Env var mapping / precedence:** `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`,
`TEMPORAL_TASK_QUEUE`, `LOG_LEVEL`, `HTTP_PORT`, `HTTP_HOST`, `CORS_ORIGIN`,
`TEMPORAL_API_KEY`. Precedence highest→lowest: real `process.env` → `.env.local` → `.env`
→ schema defaults. Runs with no env files present.

## 6a-bis. Logging contract (`src/infra/logger.ts`)

A single shared **pino** instance, level from `AppConfig.logLevel`, is the logging seam.

- **Activities, worker, CLI, API** use this pino logger (or Fastify's built-in pino, which
  is configured from the same level).
- **Workflows** must NOT use pino or any direct I/O — they log via `import { log } from
'@temporalio/workflow'` (routed through sinks). This preserves determinism (§7).
- `pino-pretty` is a dev-only transport for readable local output; JSON in production.

## 6b. Contracts & layer boundaries (strict)

Contracts are explicit at every seam; dependencies point **inward only**
(`interfaces`/`infra` → `application` → `domain`). Nothing in `domain` imports a framework.

| Seam            | Contract (owner)                                              | Consumers                              | Strictness                                        |
| --------------- | ------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------- |
| Config          | `AppConfig` + `AppConfigSchema` (`infra/config.ts`)           | worker, client, connection             | zod at load (runtime)                             |
| Domain model    | entities/VOs in `domain/agent.ts`                             | all layers                             | TS types + `strictest`                            |
| Activity port   | `AiToolsActivities` (`domain/ports.ts`)                       | workflow (proxy), infra adapter (impl) | TS interface; adapter must `satisfies` it         |
| Workflow API    | `AgentInput`, `AgentResult` (`application/agent.workflow.ts`) | CLI, HTTP API, tests                   | zod-validate `AgentInput` at workflow entry       |
| Signals/queries | defs + payload types (`application/contracts.ts`)             | workflow, CLI, HTTP API, UI            | zod-validate payloads in handlers (external JSON) |
| HTTP API        | REST endpoints (`interfaces/http`) — see §6d                  | external HTTP callers                  | zod-validate request body/params; helmet + cors   |

**Rules:**

- `application` must **not** import `infra` (workflow proxies the _port_, not the impl).
- `domain` imports nothing from `application`/`infra`/`@temporalio/*`.
- `contracts.ts` is the **single source** of signal/query names and payload types (DRY) —
  the client and the ops runbook reference it, never re-declare names.
- The infra adapter is typed `satisfies AiToolsActivities` so the port and impl can't drift.
- External JSON (signal payloads, `AgentInput`) is **parsed with zod at the boundary**;
  once past the boundary, code trusts the inferred types.

## 6c. Principles → concrete rules

Not slogans — each maps to something checkable in review:

- **SRP (S):** one reason to change per module — domain = business rules, application =
  orchestration, infra = I/O/adapters, interfaces = process entrypoints. No mixing.
- **OCP (O):** new "tools" are added by extending `ToolName` + a domain branch, without
  editing the workflow's control flow.
- **LSP / ISP (L/I):** `AiToolsActivities` is the minimal port the workflow needs — no
  extra methods; any implementation satisfying it is substitutable (real vs mocked).
- **DIP (D):** high-level policy (workflow) depends on the port abstraction; the concrete
  adapter and config are injected at the edges (worker registration, `loadConfig`).
- **DDD:** ubiquitous language (`Plan`, `PlanStep`, `AgentState`); domain is pure and
  framework-free; ports & adapters separate core from Temporal.
- **DRY:** one config reader, one contracts module, types inferred from zod schemas (no
  duplicated shape definitions).
- **KISS:** single package, single task queue, in-memory only; **no** child workflows,
  continue-as-new, DB, or abstraction we don't currently use.

## 6d. HTTP API contract (`src/interfaces/http`)

A **Fastify** app that is a Temporal **Client** (not a worker — it hosts no workflow code).
It maps REST calls onto the same signals/queries in `contracts.ts`. Thin adapter: no
business logic, no state; every handler just validates input and calls the Temporal Client.

**Cross-cutting:** `@fastify/helmet` (security headers) + `@fastify/cors` (origin from
`AppConfig.corsOrigin`) registered globally; request/response logging via Fastify's pino.

**Response envelope** (consistent): success → `{ data: <payload> }`; error →
`{ error: { code, message, details? } }` with the matching HTTP status.

| Method & path               | Body / params                              | Temporal action                     | Success                          | Errors               |
| --------------------------- | ------------------------------------------ | ----------------------------------- | -------------------------------- | -------------------- |
| `POST /agents`              | `{ topic: string (1..) }`                  | `client.start(agentWorkflow, …)`    | `201 { data: { workflowId } }`   | `400` invalid body   |
| `GET /agents/:id`           | `id` param                                 | `handle.query(getState)`            | `200 { data: AgentState }`       | `404` unknown id     |
| `POST /agents/:id/approve`  | `{ approved: boolean, feedback?: string }` | `handle.signal(approvePlan, …)`     | `202` (accepted)                 | `400` invalid, `404` |
| `POST /agents/:id/guidance` | `{ guidance: string (1..) }`               | `handle.signal(provideGuidance, …)` | `202`                            | `400`, `404`         |
| `POST /agents/:id/cancel`   | —                                          | `handle.signal(cancelAgent)`        | `202`                            | `404`                |
| `GET /healthz`              | —                                          | — (liveness)                        | `200 { data: { status: 'ok' } }` | —                    |

**Rules:**

- Signals are fire-and-forget → `202 Accepted` (a signal cannot report workflow outcome).
- Request schemas live in `interfaces/http/schemas.ts` and **reuse** the payload schemas
  from `contracts.ts` where they overlap (e.g. `ApprovePlanInput`) — DRY, no re-declaring.
- Map Temporal errors to HTTP: workflow-not-found → `404`; validation → `400`; else `500`
  with a generic message (no internal details leaked — see §7).
- The API depends only on `application/contracts` + `infra` (Client, config, logger); it
  must not import `domain` internals or `infra/activities`.

## 7. Determinism & correctness constraints

- **No** `Date.now()` / `Math.random()` / I/O in workflow code — all non-determinism lives
  in activities. (The SDK sandbox patches the first two, but we still avoid relying on them.)
- Iterate `plan.steps` in stable order; step ids are stable within a revision.
- Signal handlers are **non-async** (they only mutate local state); no activities/sleeps in
  handlers or in the query handler or update validators.
- Under `@tsconfig/strictest`, `noUncheckedIndexedAccess` makes indexed access `T |
undefined` — guard array/index reads explicitly.
- All `@temporalio/*` packages must share one identical version.
- Zod validation is **synchronous** — safe inside signal/query handlers (no async, no
  activities). Invalid signal payloads are validated then rejected/ignored with a logged
  reason (a signal cannot fail the sender); malformed `AgentInput` throws at workflow entry.

## 8. Run & interaction model

- Cluster (`temporal`) → Worker (`worker`, hosts workflow+activities) → Client (starts).
- After `start`, the workflow **blocks** at `awaiting_approval`. A human then:
  - inspects the plan: `getState` query (Web UI or `temporal workflow query`), and
  - approves/rejects: `approvePlan` signal (Web UI or `temporal workflow signal`).
- The client process may exit immediately after starting; the workflow persists in the
  cluster and continues on the worker regardless.

## 9. Acceptance criteria

- [ ] **Happy path:** start → approve → workflow completes with a non-empty `finalAnswer`
      derived from all step results; `stepCount === plan.steps.length`.
- [ ] **Reject → re-plan:** `approvePlan(false, feedback)` produces a new plan, increments
      `revision`, and remains awaiting approval; feedback reaches `planTask`.
- [ ] **Reject limit:** after `MAX_REJECTIONS` rejections the workflow ends `rejected`.
- [ ] **Cancel while waiting:** `cancel` before approval ends the workflow `cancelled`.
- [ ] **Cancel during execution:** `cancel` mid-execution ends `cancelled` without running
      remaining steps.
- [ ] **Query:** `getState` returns an accurate snapshot at each phase and never mutates
      state.
- [ ] **Guidance:** `provideGuidance` before/at execution is reflected in `runTool` output.
- [ ] **Determinism:** workflow replays cleanly (no non-determinism errors) — verified by
      the Vitest time-skipping environment.
- [ ] **Config:** `loadConfig()` returns defaults with no env files; `.env.local` overrides
      `.env`; invalid `LOG_LEVEL` throws a clear error.
- [ ] **Boundary validation:** malformed `approvePlan` JSON is rejected (logged, state
      unchanged); malformed `AgentInput` throws at workflow entry.
- [ ] **Boundaries hold:** `application` does not import `infra`; `domain` imports no
      framework; the HTTP API imports no `domain`/`infra/activities` internals.
- [ ] **HTTP API:** `POST /agents` starts a run and returns `201 { data: { workflowId } }`;
      `GET /agents/:id` returns the state; `POST .../approve` returns `202` and drives the
      workflow to completion; invalid bodies → `400`; unknown id → `404`; `GET /healthz` →
      `200`. Responses carry helmet security headers.
- [ ] **Logging:** structured pino output at `LOG_LEVEL`; workflows log via SDK `log`, not
      pino.
- [ ] **Commits:** a non-conventional commit message is rejected by commitlint (commit-msg
      hook); pre-commit runs lint + build.
- [ ] **Quality gates:** `npm run build`, `npm run lint`, `npm run format:check`,
      `npm test` all pass.

## 10. Test plan (three tiers, Vitest)

### Smoke — manual (`curl`, not automated)

A documented checklist against a live stack (`temporal server start-dev` + `npm run worker`

- `npm run api`): `POST /agents` → `GET /agents/:id` → `POST /agents/:id/approve` → confirm
  `completed`. Lives in the `temporal-agent-ops` skill / README.

### Unit — colocated (`*.test.ts` beside the source), collaborators mocked

- `src/domain/agent.test.ts` — pure `planTask` / `runTool` / `synthesize`, incl. edge cases.
- `src/infra/config.test.ts` — defaults with no env files; `.env.local` overrides `.env`;
  invalid `LOG_LEVEL` throws.
- `src/application/agent.workflow.test.ts` — `TestWorkflowEnvironment.createTimeSkipping()`
  with **mocked activities** (the workflow's decision logic in isolation):
  - Happy path — start, assert awaiting approval via `getState`, `approvePlan(true)`, await
    result, assert `completed` + final answer + step count.
  - Reject then approve — `approvePlan(false, 'more detail')`, assert revision bump &
    feedback passed to mocked `planTask`, then approve and complete.
  - Reject limit — reject `MAX_REJECTIONS` times → `rejected`.
  - Cancel while waiting / during execution → `cancelled`.
  - Malformed `approvePlan` payload → rejected/ignored, state unchanged.
- `src/interfaces/http/routes/agents.test.ts` — Fastify `app.inject()` with a **mocked
  Temporal Client**: status codes, `{data}`/`{error}` envelope, zod `400` on bad bodies,
  `404` when the client throws not-found, `/healthz`, and that handlers call the right
  Client method with the validated payload.

### Feature / e2e — `features/` (repo root), everything real

- `features/agent-lifecycle.feature.test.ts` — test server + **real worker + real
  activities**: start via the client, query `getState`, send the real `approvePlan` signal,
  assert the workflow reaches `completed` with a real synthesized answer across all layers.
- `features/http-api.feature.test.ts` — **real Fastify app → real Temporal Client → real
  worker**: full path `POST /agents` → `GET /agents/:id` → `POST /agents/:id/approve`, poll
  until `completed`. Validates the layers actually wire together (API → client → workflow →
  activities → domain).
