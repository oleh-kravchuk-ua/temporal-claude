# Tasks — Temporal AI-Agent demo

> Phased, checkboxed breakdown. Each task traces to [`SPEC.md`](./SPEC.md) (§) and
> [`PLAN.md`](./PLAN.md). Check items off as we go; expect to adjust.

## Phase 0 — Tooling & config

- [x] Add runtime deps: `zod fastify @fastify/cors @fastify/helmet pino`
      _(no `undici` dep — use Node's built-in `fetch`)_
- [x] Add dev deps (single line to keep Prettier happy): `typescript tsx @types/node vitest @temporalio/testing @tsconfig/strictest eslint @eslint/js typescript-eslint prettier eslint-config-prettier globals husky @commitlint/cli @commitlint/config-conventional pino-pretty` _(runtime `@temporalio/*` already installed; `globals` added for ESLint Node globals)_
- [x] `tsconfig.json` extending `@tsconfig/strictest` (ESNext, `moduleResolution: Bundler`,
      `verbatimModuleSyntax`, **`noEmit`** — typecheck only, we run via tsx; include
      `src`/`features`/`*.config.ts`)
- [x] `eslint.config.js` — ESLint v10 flat config, type-aware (`recommendedTypeChecked` via
      `projectService`), `_`-prefixed unused args OK, `consistent-type-imports` on;
      `no-restricted-imports` forbids `application`→`infra`/`interfaces` and any
      `@temporalio/*`/outer-layer import from `domain`; Node globals via `globals`;
      **`eslint-config-prettier` last**
- [x] `.prettierrc` + `.prettierignore` (ignore `dist`, `coverage`, `node_modules`,
      `package-lock.json`, `.husky`)
- [x] `vitest.config.ts` — Node environment, 30s timeouts,
      `include: ['src/**/*.test.ts', 'features/**/*.test.ts']`
- [x] `package.json` scripts: `worker`, `api`, `start`, `build`, `lint`, `format`,
      `format:check`, `test`, `test:unit` (`vitest run src`), `test:feature`
      (`vitest run features`), `test:watch`, `prepare` (husky)
- [x] `.env.example` — documents `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`,
      `TEMPORAL_TASK_QUEUE`, `LOG_LEVEL`, `HTTP_PORT`, `HTTP_HOST`, `CORS_ORIGIN`,
      `TEMPORAL_API_KEY`
- [x] Confirmed `.gitignore` keeps `.env`/`.env.local` ignored and `.env.example` tracked
- [x] `husky init`; `.husky/commit-msg` → `npx --no -- commitlint --edit "$1"`;
      `.husky/pre-commit` → `npm run format:check && npm run lint && npm run build`
- [x] `commitlint.config.js` — `export default { extends: ['@commitlint/config-conventional'] }`
- [x] Verified: `format:check`, `lint`, `build` (tsc --noEmit) all pass; commitlint
      accepts a conventional message and rejects a bad one

## Phase 1 — Domain (pure, no Temporal) — SPEC §2, §6c

- [ ] `src/domain/agent.ts` — types (`PlanStep`, `Plan`, `StepResult`, `AgentStatus`,
      `AgentState`) + pure fns `planTask`, `runTool`, `synthesize` (mocked, deterministic).
      No framework imports (DDD/DIP).
- [ ] `src/domain/ports.ts` — `AiToolsActivities` port (minimal — ISP) — SPEC §5
- [ ] Domain unit tests (part of Phase 5) — SPEC §10

## Phase 2 — Application (workflow + contracts) — SPEC §3, §4, §6, §6b

- [ ] `src/application/contracts.ts` — `TASK_QUEUE`, `approvePlan`/`provideGuidance`/`cancel`
      signals, `getState` query, `ApprovePlanInput` + zod schemas for signal payloads
      (single source of truth — DRY)
- [ ] `src/application/agent.workflow.ts` — `agentWorkflow`:
  - [ ] zod-validate `AgentInput` at entry — SPEC §6b
  - [ ] `proxyActivities<AiToolsActivities>` with retry policy (depends on the port, not
        infra — DIP) — SPEC §5
  - [ ] non-async signal handlers with synchronous zod validation of payloads;
        read-only `getState` handler — SPEC §7
  - [ ] state machine: plan → await-approval → (reject/re-plan loop, MAX_REJECTIONS) →
        execute → synthesize → complete; cancel path — SPEC §6
  - [ ] guard indexed access for `noUncheckedIndexedAccess` — SPEC §7
  - [ ] **must not import `infra`** — SPEC §6b

## Phase 3 — Infra (adapters + worker) — SPEC §5, §6a, §8

- [ ] `src/infra/config.ts` — load `.env`/`.env.local`, zod-validate → frozen `AppConfig`
      (only reader of `process.env`) — SPEC §6a
- [ ] `src/infra/logger.ts` — shared pino instance from `AppConfig.logLevel`
      (`pino-pretty` in dev) — SPEC §6a-bis
- [ ] `src/infra/activities/ai-tools.ts` — `satisfies AiToolsActivities`, delegates to
      domain; logs via pino
- [ ] `src/infra/connection.ts` — `NativeConnection` (worker) + `Client`/`Connection`
      (api/cli) built from `AppConfig` (address/namespace/API key)
- [ ] `src/infra/worker.ts` — `loadConfig()` → `Worker.create({ workflowsPath, activities,
taskQueue })` + run, graceful shutdown on SIGINT/SIGTERM

## Phase 4 — Interfaces (client) — SPEC §8

- [ ] `src/interfaces/cli/client.ts` — `loadConfig()`, start `agentWorkflow`, print workflow
      id + how to approve (Web UI / CLI / API hints), exit (start-only). Depends only on
      `application/contracts` + infra Client/config — not on `infra/activities` or `domain`

## Phase 4b — HTTP API (Fastify) — SPEC §6d, §6a-bis

- [ ] `src/interfaces/http/schemas.ts` — zod request/params schemas, reusing
      `contracts.ts` payload schemas where they overlap (DRY)
- [ ] `src/interfaces/http/routes/agents.ts` — `/agents` start/query/signal/cancel +
      `/healthz`, mapping to the Temporal Client; consistent `{ data }` / `{ error }` envelope
- [ ] `src/interfaces/http/server.ts` — Fastify bootstrap: pino logger, `@fastify/helmet`,
      `@fastify/cors` (from `corsOrigin`), register routes, `loadConfig()` → listen on
      `httpHost:httpPort`; graceful shutdown; **no business logic** (thin adapter) — SPEC §6d

## Phase 5 — Tests (three tiers) — SPEC §9, §10

### Unit — colocated (`*.test.ts` beside source), collaborators mocked

- [ ] `src/domain/agent.test.ts` — `planTask` / `runTool` / `synthesize` + edge cases
- [ ] `src/infra/config.test.ts` — defaults with no env files; `.env.local` overrides
      `.env`; invalid `LOG_LEVEL` throws — SPEC §6a
- [ ] `src/application/agent.workflow.test.ts` (time-skipping + mocked activities):
  - [ ] happy path (approve → completed)
  - [ ] reject → re-plan (revision bump, feedback passed)
  - [ ] reject limit → `rejected`
  - [ ] cancel while waiting / during execution → `cancelled`
  - [ ] malformed `approvePlan` payload → rejected/ignored, state unchanged — SPEC §6b
- [ ] `src/interfaces/http/routes/agents.test.ts` — `app.inject()` + mocked Temporal Client:
      status codes, `{ data }`/`{ error }` envelope, `400` on bad body, `404` mapping,
      `/healthz` — SPEC §6d

### Feature / e2e — `features/` (repo root), everything real

- [ ] `features/agent-lifecycle.feature.test.ts` — test server + real worker + real
      activities: start → query → approve → `completed` with a real synthesized answer
- [ ] `features/http-api.feature.test.ts` — real Fastify app → real client → real worker:
      `POST /agents` → `GET /agents/:id` → `POST /agents/:id/approve` → poll until `completed`

### Smoke — manual (not automated)

- [ ] Documented `curl` checklist in the `temporal-agent-ops` skill / README (covered in
      Phase 7 manual smoke)

## Phase 6 — Docker — PLAN §Run model

- [ ] `Dockerfile` (multi-stage, `node:22-slim`; verify `@temporalio/core-bridge` prebuild)
- [ ] `.dockerignore` (include `.env`, `.env.local`, `node_modules`, `dist`, `.git`)
- [ ] `docker-compose.yml` — `temporal` (start-dev, ports 7233/8233), `worker`, `api`
      (port 3000), `client` (one-shot, `profiles: [tools]`), healthcheck + `depends_on`;
      env `TEMPORAL_ADDRESS=temporal:7233` for worker/api/client

## Phase 7 — Verify & document

- [ ] `npm run build` (strict typecheck) passes
- [ ] `npm run lint` passes (zero errors)
- [ ] `npm run format:check` passes (code is Prettier-clean)
- [ ] `npm test` passes (all acceptance criteria — SPEC §9)
- [ ] Manual smoke: `temporal server start-dev` → `npm run worker` → `npm run api` →
      `POST /agents` → `GET /agents/:id` → `POST /agents/:id/approve` → `completed`
      (and the CLI `npm run start` + UI/CLI approve path)
- [ ] Rewrite `README.md` (what it is + both run modes + HITL steps)
- [ ] Update `CLAUDE.md` "Current state" with real architecture & commands
- [ ] Update `.claude/skills/temporal-agent-ops.md` if anything drifted
- [ ] Boundary/principles pass: `application`↛`infra`, `domain` framework-free, adapter
      `satisfies` port, `contracts.ts` sole owner of signal/query names — SPEC §6b, §6c

## Definition of done

All Phase 7 boxes checked; acceptance criteria in SPEC §9 met; docs reflect reality.
