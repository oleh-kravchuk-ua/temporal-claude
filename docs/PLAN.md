# Implementation Plan: Claude-backed `AiToolsActivities`

> Implements `docs/SPEC.md`. Status: **DRAFT — awaiting review (Phase 2: Plan).**
> Task list with phases and checkboxes: `docs/TASKS.md`.

## Overview

Add `createClaudeAiTools` — a second implementation of the `AiToolsActivities` port using
`@anthropic-ai/sdk` — plus config (`AI_PROVIDER`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`) and
selection in `activities/index.ts`. The workflow, port, types, HTTP API and CLI are untouched.
Default stays `mock`, so every existing test and the offline demo keep working.

## Dependency graph

```mermaid
flowchart TD
  T1[T1 SDK spike + dependency] --> T3[T3 Prompts + plan schema]
  T1 --> T4[T4 Error classification]
  T2[T2 Config: ai.*] --> T7[T7 Selector + worker wiring]
  T3 --> T5[T5 planTask]
  T4 --> T5
  T5 --> T6[T6 runTool + synthesize]
  T6 --> T7
  T7 --> T8[T8 Live smoke + manual HITL run]
  T8 --> T9[T9 Docs]
```

T2 is independent of T1/T3/T4 and can run in parallel with them; everything else is sequential.

## Architecture decisions

- **Client is injected, not imported in the adapter.** `createClaudeAiTools(logger, client, { model })` takes `Pick<Anthropic, 'messages'>`, so unit tests pass a fake. The real `new Anthropic({ apiKey, maxRetries: 0 })` is built only in the selector's `claude` branch — the mock path never constructs it.
- **Temporal owns retries** (`maxRetries: 0`). Classification lives in one pure helper (`claude-errors.ts`) so the table in the spec is unit-testable in isolation.
- **Prompts are pure functions** in `claude-prompts.ts` (topic/feedback/guidance in → messages out), separately testable from the SDK call. User text goes in the user turn inside delimited tags, never in `system`.
- **Plan validation at the adapter edge** with Zod: 1–8 steps, `tool ∈ ToolName`, non-empty descriptions; ids assigned by code. Reuse the `ToolName` union from `workflow/types.ts` (a const tuple duplicated in the schema must be `satisfies`-checked against it so they can't drift).
- **Fail-fast config:** the key requirement is a Zod `superRefine` on `AppConfig` (provider `claude` ⇒ key present), so the error surfaces in `loadConfig()` before the worker connects to Temporal.
- **No workflow changes.** Timeout stays `1 minute` unless T8 shows it is too tight (then a separate, flagged change — Ask-first per spec).
- **Vertical slicing:** T5 delivers a working `planTask` end-to-end (prompt → call → validate → error mapping) before `runTool`/`synthesize` reuse the same pattern in T6.

## Risks and mitigations

| Risk                                                                                                          | Impact | Mitigation                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SDK structured-output API/shape differs from my assumption (`output_config.format`, Zod helper, Zod 4 compat) | High   | **T1 spike first**: install, read installed types/docs (context7), write findings into this plan before any adapter code. Fallback: hand-written JSON schema + `JSON.parse` + Zod. |
| `claude-sonnet-5` rejects a param (sampling, thinking, effort placement) → 400 at runtime                     | Med    | T1 records exact accepted params; T8 live smoke catches any remainder. Unit tests assert the request has no `temperature`/`top_p`/`budget_tokens`.                                 |
| Activity exceeds 1-minute `startToCloseTimeout`                                                               | Med    | Small `max_tokens`, thinking off; measure in T8; raise only with approval.                                                                                                         |
| API key leaks via logs/errors/`.env`                                                                          | High   | Key only in `AppConfig.ai.apiKey`; never log config or SDK request options; test asserts key absent from thrown/logged values; `.env.local` already git-ignored.                   |
| Prompt injection via topic/feedback/guidance                                                                  | Med    | Delimited-data prompt design; output is schema-validated and only ever rendered as text; no tool execution from model output.                                                      |
| Model returns plan with bad tool names / 0 or 30 steps                                                        | Med    | Zod bounds → non-retryable failure (retrying an identical prompt rarely fixes it; workflow surfaces the error).                                                                    |
| Cost surprises during demo                                                                                    | Low    | Small per-activity `max_tokens`; default provider `mock`; live test opt-in.                                                                                                        |
| `noUncheckedIndexedAccess` / `verbatimModuleSyntax` friction with SDK types                                   | Low    | Use `import type Anthropic`; narrow content blocks by `.type`.                                                                                                                     |

## Verification checkpoints

- **After T4 (foundations):** build/lint/format clean; new pure modules fully unit-tested; no adapter yet.
- **After T7 (wired, offline):** `npm test` all green (existing 22 + new); default provider path proven unchanged; `AI_PROVIDER=claude` w/o key fails fast.
- **After T8 (live):** real HITL run recorded (workflow id, plan, final answer excerpt) — evidence for Success Criterion 3.
- **After T9 (done):** all 8 spec success criteria checked off.

## Process constraints (from project memory)

- Work on a **feature branch** (e.g. `feat/claude-ai-tools`), never master; verify the branch before every commit.
- **No commit/push without explicit approval**; Conventional Commits (commitlint); husky pre-commit runs `format:check` + `lint` + `build`.
- **Do not start the next phase/task batch without confirmation** at each checkpoint.

## Open questions

Spec open questions resolved by their stated defaults (thinking off; timeout unchanged unless
T8 demands; hard-coded per-activity token limits; no prompt caching). Say so if any should change.
