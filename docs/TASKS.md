# Tasks: Claude-backed `AiToolsActivities`

Spec: `docs/SPEC.md` · Plan: `docs/PLAN.md`
Branch: `feat/claude-ai-tools` (create before T1; never master). No commits without approval.
Sizing: XS 1 file · S 1–2 · M 3–5. Global verify for every task: `npm run build && npm run lint && npm run format:check`.

## Phase 1 — Foundation

- [x] **T1: SDK spike + add dependency** (S)
  - Acceptance: `@anthropic-ai/sdk` in `dependencies`; a "SDK findings" section appended to `docs/PLAN.md` records the exact: structured-output param/helper (and Zod 4 compatibility), accepted params for `claude-sonnet-5` (thinking/effort placement, no sampling params), error class names, `stop_reason` values to handle (`refusal`, `max_tokens`). Fallback approach chosen if the Zod helper doesn't fit.
  - Verify: `npm run build`; findings reviewed against installed `node_modules/@anthropic-ai/sdk` types / context7 (not memory).
  - Files: `package.json`, `package-lock.json`, `docs/PLAN.md`
  - Depends: none

- [x] **T2: Config `ai.*`** (S) — parallel with T1/T3/T4
  - Acceptance: `AppConfig.ai = { provider: 'mock'|'claude' (default mock), model (default `claude-sonnet-5`), apiKey? }` from `AI_PROVIDER`/`ANTHROPIC_MODEL`/`ANTHROPIC_API_KEY`; `provider=claude` without key → `loadConfig` throws naming `ANTHROPIC_API_KEY` (never echoing a value); `.env.example` documents the three vars; no-env-file run still works.
  - Verify: `npx vitest run src/infra/config` (new cases: default, override, missing key, empty key, invalid provider).
  - Files: `src/infra/config/types.ts`, `src/infra/config/load.ts`, `src/infra/config/config.test.ts`, `.env.example`
  - Depends: none

- [x] **T3: Prompts + plan schema (pure)** (S)
  - Acceptance: `claude-prompts.ts` exports builders for plan/step/synthesis prompts and `PlanOutputSchema` (1–8 steps, `tool ∈ ToolName`, non-empty description) plus `toPlan` assigning 1-based ids and trimming topic. `ToolName` tuple in the schema is compile-checked against `workflow/types.ts`. Topic/feedback/guidance appear only in the user turn inside delimiters; `system` text is constant.
  - Verify: `npx vitest run src/activities/claude-prompts.test.ts` (feedback included/omitted, guidance joined, injection-looking topic stays inside delimiters, schema rejects 0/9 steps and unknown tool).
  - Files: `src/activities/claude-prompts.ts`, `src/activities/claude-prompts.test.ts`
  - Depends: T1

- [x] **T4: Error classification (pure)** (S)
  - Acceptance: `toActivityFailure(error)` maps per spec: RateLimit/InternalServer/Connection/Timeout → returned unchanged (retryable); BadRequest/Authentication/PermissionDenied/NotFound → `ApplicationFailure.nonRetryable`; plus `assertUsable(response)` throwing non-retryable on `stop_reason` `refusal`/`max_tokens` or missing text block. Messages never include the API key.
  - Verify: `npx vitest run src/activities/claude-errors.test.ts` (table-driven over each error class and stop reason).
  - Files: `src/activities/claude-errors.ts`, `src/activities/claude-errors.test.ts`
  - Depends: T1

### Checkpoint: Foundation

- [x] `npm run build`, `lint`, `format:check`, `test` green (83 tests)
- [x] Findings from T1 reviewed — plan still valid (adjustments: `create` + own Zod validation instead of `parse`; thinking explicitly disabled)
- [ ] **Review with human before Phase 2**

## Phase 2 — Adapter

- [x] **T5: `planTask` end-to-end (vertical slice)** (M)
  - Acceptance: `createClaudeAiTools(logger, client, { model })` returns an object `satisfies AiToolsActivities`; `planTask` builds the request (model, `max_tokens` 2048, constant system, delimited user turn, structured-output format; **no** `temperature`/`top_p`/`budget_tokens`/prefill), validates via `PlanOutputSchema`, returns a `Plan` with ids `1..n`; failures go through `toActivityFailure`/`assertUsable`; debug log has topic but not prompt/completion above debug. `runTool`/`synthesize` present but not yet implemented is NOT allowed — stub them to throw `not implemented` only until T6 within the same branch.
  - Verify: `npx vitest run src/activities/claude-ai-tools.test.ts` (happy path, feedback reaches prompt, bad plan → non-retryable, refusal → non-retryable, 429 → retryable, request shape has no forbidden params).
  - Files: `src/activities/claude-ai-tools.ts`, `src/activities/claude-ai-tools.test.ts`
  - Depends: T3, T4

- [x] **T6: `runTool` + `synthesize`** (S)
  - Acceptance: `runTool(step, guidance)` returns `{ stepId, output }` with the tool as a role in the prompt and every guidance item included; `synthesize(topic, results)` returns non-empty text built from all step outputs in order; plain-text outputs (no structured format), `max_tokens` 2048/4096, same error handling; T5 stubs removed.
  - Verify: `npx vitest run src/activities/claude-ai-tools.test.ts` (per-activity happy path, guidance present, results ordered, empty text → non-retryable).
  - Files: `src/activities/claude-ai-tools.ts`, `src/activities/claude-prompts.ts`, `src/activities/claude-ai-tools.test.ts`
  - Depends: T5

- [x] **T7: Selector + worker wiring** (S)
  - Acceptance: `createAiToolsActivities(logger, config.ai)` (signature change) returns the mock for `mock`, and for `claude` builds `new Anthropic({ apiKey, maxRetries: 0 })` and returns `createClaudeAiTools`; `worker.ts` passes `config.ai`; worker logs the chosen provider+model (not the key); the mock path never constructs the client; a test asserts `maxRetries: 0`.
  - Verify: `npx vitest run src/activities` + `npm test` (existing 22 still pass); manual: `AI_PROVIDER=claude npm run worker` with no key exits non-zero with the clear message.
  - Files: `src/activities/index.ts`, `src/activities/index.test.ts`, `src/worker.ts`
  - Depends: T2, T6

### Checkpoint: Wired, offline

- [x] `npm test` all green (115 tests); `build`/`lint`/`format:check` clean
- [x] Default (`mock`) behavior proven unchanged (existing e2e feature test untouched and passing); boundary lint rule still passes (`workflow/` has no new imports); `AI_PROVIDER=claude` without a key exits at startup naming `ANTHROPIC_API_KEY`
- [ ] **Review with human before Phase 3** (Phase 3 spends real API money)

## Phase 3 — Live verification

- [x] **T8: Live check + manual HITL run** (S) — needs your `ANTHROPIC_API_KEY`
  - Acceptance: `npm run claude:check` (a manual CLI, not a test) proves the connection and reports per-activity latency and how much of the 1-minute activity timeout the slowest call used; a full run (start → approve → completed) is recorded with workflow id, plan and final-answer excerpt; if any call nears 45 s, propose (don't apply) a timeout change.
  - Verify: `npm run claude:check`; `npm test` makes no network calls.
  - Files: `src/cli/claude-check.ts`, `src/cli/latency-stats.ts` (+ test), `package.json`, `vitest.config.ts`, `docs/PLAN.md` (results note)
  - Status: latency and request-shape checks done manually via `npm run claude:check` (results in `docs/PLAN.md`); the full reject-with-feedback → approve → completed run is also done (see `docs/PLAN.md`).
  - Depends: T7

## Phase 4 — Docs & close-out

- [ ] **T9: Documentation** (S)
  - Acceptance: `CLAUDE.md` (Workflow behavior contract) describes the Claude strategy and selector; `README.md` gains "Running with real Claude" (env vars, cost note, mock default); `CLAUDE.md` "Current state"/config bullets mention `ai.*`; `docs/PLAYBOOK.md` updated only if it lists run modes. Mermaid for any diagram.
  - Verify: `npm run format:check`; links/paths in docs resolve.
  - Files: `CLAUDE.md`, `README.md`, `docs/PLAYBOOK.md`
  - Depends: T8

### Checkpoint: Complete

- [ ] All 8 success criteria in `docs/SPEC.md` checked off
- [ ] `npm run verify` passes and `/review` reports no CRITICAL/HIGH findings
- [ ] Ready for PR (feature branch → PR, description links the spec; commit only after approval)
