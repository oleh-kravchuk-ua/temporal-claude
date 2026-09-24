# Spec: Claude-backed `AiToolsActivities`

> Status: **DRAFT — awaiting review (Phase 1: Specify).** No code until approved.
> Extends the workflow behavior contract in `CLAUDE.md` (activity port & adapter). Behavior of the workflow is unchanged.

## Objective

Add a second `AiToolsActivities` strategy, `createClaudeAiTools`, that calls Claude through
`@anthropic-ai/sdk`, selectable next to the existing mock. The workflow, its signals/queries,
the HTTP API and the CLI do not change — only the Strategy seam (`activities/index.ts`) and
config grow. This is the payoff of the port design: the swap is invisible to the workflow.

**User:** the developer running the HITL demo. **Success:** with `AI_PROVIDER=claude` and a
valid key, `POST /agents` produces a real, topic-relevant plan; approving it executes real
per-step outputs; the run completes with a synthesized answer. With the default
(`AI_PROVIDER=mock`) nothing changes and everything works offline.

### Decisions already made (from review)

| Decision  | Choice                                                                                        |
| --------- | --------------------------------------------------------------------------------------------- |
| SDK       | `@anthropic-ai/sdk` Messages API (not the Agent SDK) — one call = one retryable activity      |
| Scope     | All three activities call Claude; `runTool` is **LLM-simulated** (no real search/web backend) |
| Selection | `AI_PROVIDER=mock\|claude`, default `mock`; `claude` without a key **fails fast at startup**  |
| Model     | Default `claude-sonnet-5`, overridable via `ANTHROPIC_MODEL`                                  |

## ASSUMPTIONS I'M MAKING

1. Auth is `ANTHROPIC_API_KEY`, read **only** by `src/infra/config/` (the single `process.env` reader) and injected into the client — the SDK is never left to read env itself.
2. The port `AiToolsActivities` and `workflow/types.ts` stay as-is. `ToolName` stays `search | summarize | draft`; for Claude these become _roles_ in the prompt, not real tools.
3. **Temporal owns retries.** The SDK client is built with `maxRetries: 0`; retry policy stays in the workflow's `proxyActivities` (`maximumAttempts: 3`). Permanent failures (400/401/403/404, refusal, truncated/invalid output) are raised as non-retryable `ApplicationFailure`; 429/5xx/network/timeout stay retryable.
4. Non-streaming calls with modest `max_tokens` (plan ≈ 2k, step ≈ 2k, synthesis ≈ 4k) — no call is long enough to need streaming.
5. The workflow's `startToCloseTimeout: '1 minute'` is enough for Sonnet 5 at these sizes; if the live smoke test shows otherwise it is raised in the workflow (a workflow change, flagged in the plan).
6. `planTask` returns **structured output** validated by Zod (`Plan`-shaped: 1–8 steps, `tool ∈ ToolName`); the workflow's existing "non-empty plan" contract is enforced at the adapter boundary. Ids are assigned by code (1-based), not trusted from the model.
7. Model params for `claude-sonnet-5`: adaptive thinking allowed but not required (thinking off/omitted, `effort: 'low'` for `runTool`); **no** `temperature`/`top_p`/`budget_tokens`/prefill (rejected with 400 on this model).
8. User-supplied text (topic, feedback, guidance) is **data, not instructions**: placed in the user turn inside delimited tags, never concatenated into the system prompt.
9. Guidance/feedback semantics carry over from the mock: `feedback` triggers a re-plan that addresses it; `guidance[]` is applied to every subsequent `runTool` call.

→ Correct me now or I'll proceed with these.

## Tech Stack

- Existing: Node ≥26, TypeScript strictest, Temporal SDK 1.24, Fastify, Zod 4, pino, Vitest.
- **New dependency (approved):** `@anthropic-ai/sdk` (latest at implementation time; pin caret range like siblings).
- No other new dependencies. Zod→JSON-schema for structured output uses whatever the SDK's helper provides; verified in Plan (Task 1) against the SDK docs via context7 / installed types before use.

## Commands

```
Build:        npm run build
Lint:         npm run lint
Format check: npm run format:check
Unit tests:   npx vitest run src/activities/claude-ai-tools.test.ts
All unit:     npm run test:unit
Feature:      npm run test:feature
Live smoke:   ANTHROPIC_API_KEY=... npx vitest run src/activities/claude-ai-tools.live.test.ts   # opt-in, skipped w/o key
Run (real):   AI_PROVIDER=claude ANTHROPIC_API_KEY=... npm run worker   # + npm run api / npm start
```

## Project Structure

```
src/activities/
├── index.ts                    # Strategy selector: switch on config.ai.provider (extended)
├── mock-ai-tools.ts            # unchanged
├── claude-ai-tools.ts          # NEW: createClaudeAiTools(logger, client, options) satisfies AiToolsActivities
├── claude-ai-tools.test.ts     # NEW: unit tests, fake client injected, no network
├── claude-ai-tools.live.test.ts# NEW: opt-in live smoke (skipped without key)
└── claude-prompts.ts           # NEW: prompt builders + Zod schema for plan output (pure, unit-testable)
src/infra/config/               # + ai.{provider,model,apiKey?,maxRetries fixed 0}; .env.example gains ANTHROPIC_* / AI_PROVIDER
CLAUDE.md                     # contract section updated to reference this strategy once implemented
README.md                       # "Running with real Claude" section
```

`worker.ts` keeps calling one factory. The client is constructed in `activities/index.ts`
(or a tiny `claude-client.ts`) from `AppConfig`, and **injected** into `createClaudeAiTools`
— mirroring how the logger is injected — so unit tests pass a fake and never touch the network.

## Code Style

Follows repo conventions: arrow functions, ES modules, `import type`, Zod at the edges,
injected logger, `satisfies AiToolsActivities`.

```ts
export const createClaudeAiTools = (
  logger: Logger,
  client: Pick<Anthropic, 'messages'>,
  { model }: { model: string },
): AiToolsActivities => ({
  planTask: async (topic, feedback) => {
    logger.debug({ topic, hasFeedback: feedback !== undefined }, 'planTask');
    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      system: PLANNER_SYSTEM,
      messages: [{ role: 'user', content: buildPlanPrompt(topic, feedback) }],
      output_config: { format: planOutputFormat },
    });
    return toPlan(topic, parseStructured(response, PlanOutputSchema)); // throws non-retryable on refusal/invalid
  },
  // runTool, synthesize: same shape, plain-text output
});
```

Error mapping lives in one helper (`toActivityFailure`): `Anthropic.RateLimitError`,
`InternalServerError`, `APIConnectionError`, `APIConnectionTimeoutError` → rethrow (retryable);
`BadRequestError`, `AuthenticationError`, `PermissionDeniedError`, `NotFoundError`, refusal
stop reason, `max_tokens` truncation, Zod parse failure → `ApplicationFailure.nonRetryable`.

## Testing Strategy

| Tier               | What                                                                                                                                                                                                                                              | Network |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Unit (colocated)   | Fake `client.messages.create` returning canned responses: happy path ×3 activities; feedback/guidance reach the prompt; malformed/empty plan → non-retryable; `refusal`/`max_tokens` → non-retryable; 429/5xx/connection → retryable; ids 1-based | none    |
| Unit (config)      | `AI_PROVIDER` default `mock`; `claude` w/o key → clear error; model override; key never appears in logged config                                                                                                                                  | none    |
| Unit (selector)    | `createAiToolsActivities` returns mock vs claude per config                                                                                                                                                                                       | none    |
| Feature (existing) | Unchanged; runs on the mock                                                                                                                                                                                                                       | none    |
| Live smoke         | One `planTask` + one `synthesize` against the real API; skipped unless `ANTHROPIC_API_KEY` set; never in CI                                                                                                                                       | yes     |

Coverage expectation: the new files are fully covered by unit tests (respect `vitest.config.ts` excludes; the live test is excluded from `test`/`test:unit` default runs via the skip guard).

## Boundaries

- **Always:** validate model output with Zod before returning it; keep `workflow/` free of `@anthropic-ai/sdk` and of `activities/` imports; inject client + logger; read env only in `infra/config`; run `build`/`lint`/`format:check`/unit tests before proposing a commit; keep mock as the default.
- **Ask first:** changing the port (`workflow/ports.ts`) or `workflow/types.ts`; changing workflow timeouts/retry policy; adding any dependency beyond `@anthropic-ai/sdk`; adding real tools (web search) or streaming; enabling prompt caching / thinking; changing the default model.
- **Never:** commit a key or `.env.local`; log the API key, or full prompts/completions above `debug`; call the API from `workflow/` code; let the SDK retry internally; trust model-supplied ids/tool names without validation; make unit/feature tests hit the network; push to master.

## Success Criteria

1. `AI_PROVIDER` unset → behavior identical to today; all 22 existing tests pass untouched.
2. `AI_PROVIDER=claude` without `ANTHROPIC_API_KEY` → worker exits non-zero at startup with a message naming the missing variable (no key echoed).
3. `AI_PROVIDER=claude` + key: full HITL run (start → plan awaiting approval → approve → completed) yields a `finalAnswer` derived from real model output; manual verification recorded in the PR.
4. A rejected-then-replanned run passes `feedback` to the model and the new plan reflects it (unit-asserted via prompt contents).
5. Every plan returned satisfies: 1–8 steps, ids `1..n`, `tool ∈ ToolName`, non-empty descriptions — else non-retryable failure.
6. Error classification table (above) verified by unit tests, including that the SDK client is constructed with `maxRetries: 0`.
7. `npm run build`, `lint`, `format:check`, `test:unit`, `test:feature` all green; no network in any default test run.
8. `workflow/` has no new imports (ESLint boundary rule still passes); `CLAUDE.md` (Workflow behavior contract) and `README.md` updated.

## Open Questions

1. **Default thinking/effort for `planTask` and `synthesize`:** off (cheapest, my default) vs adaptive at `medium` for better plans?
2. **Timeout headroom:** keep `startToCloseTimeout: '1 minute'` and only raise it if the smoke test demands it (my default), or raise proactively to 2 minutes now?
3. **Cost guard:** worth an optional `AI_MAX_OUTPUT_TOKENS`-style cap in config, or hard-code per-activity limits (my default)?
4. **Prompt caching:** skip for now (prompts are small and short-lived) — agree?

## Next phases (gated)

Plan (`docs/PLAN.md`) → Tasks (`docs/TASKS.md`) → Implement (TDD, one task at a time, on a feature branch — never master; no commit without your approval).
