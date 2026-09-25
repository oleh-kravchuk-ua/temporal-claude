# Next steps

Follow-ups after the Claude integration (adapter, config, timeouts, `claude:check`, docs). Nothing
here blocks using the app; it is a to-do list, roughly in priority order. Delete items as they land.

## 1. Land T9 (docs)

- [ ] Commit and push `docs/claude-integration-final` (README "Running with real Claude", the
      `CLAUDE.md` "Claude adapter" section, PLAYBOOK note, and removal of `docs/SPEC.md`,
      `PLAN.md`, `TASKS.md`). Suggested split: docs in one commit, the removal in another.
- [ ] The removed plan (SDK findings, measurement tables) lives in git history:
      `git show 2064886:docs/PLAN.md`.

## 2. Verification gaps (never run against the real API)

- [ ] **Full workflow re-run after the token-cap fix.** The `runTool` word budget was measured with
      `npm run claude:check`, not through a complete workflow. Re-run start → approve → completed and
      look at final-answer quality (shorter step outputs give a shorter answer: ~970 vs ~1750 tokens).
- [ ] **`provideGuidance` with real Claude** (signal mid-run). Unit-tested only.
- [ ] **Docker Compose with `AI_PROVIDER=claude`.** Compose reads `.env`/`.env.local`, so it should
      work, but it has never been run with Claude.
- [ ] Real failure paths (timeout, 429, refusal, truncation) are covered only by unit tests with
      fake errors. Optional: force a timeout by temporarily lowering `CLAUDE_REQUEST_TIMEOUT_MS`.

## 3. Housekeeping

- [ ] **Skills cleanup (optional).** Analysis result: remove the ones a built-in already covers
      (`code-review-and-quality`, `context-engineering`, `using-agent-skills`, `interview-me`,
      `idea-refine`) and the ones that don't fit a backend (`frontend-ui-engineering`,
      `browser-testing-with-devtools`, `ci-cd-and-automation`, `deprecation-and-migration`,
      `shipping-and-launch`); consider `temporal-agent-ops` (README, PLAYBOOK and `CLAUDE.md`
      cover the same ground). Use `npx skills remove <name>` so `skills-lock.json` stays consistent.
- [ ] `npx skills update` warns "Multiple current paths match" for all 25 Osmani skills: upstream
      has a `.opencode/skills` symlink to `../skills/` and the CLI (v1.7.0) counts each skill twice.
      Harmless; re-check after a CLI or upstream fix, or report it.
- [ ] Account-level claude.ai connectors (Gmail, Calendar, Drive, Docs) are unused here; switch
      them off in claude.ai settings if you don't want them in every session.

## 4. Ideas (only if they earn their keep)

- **Worst-case wait:** 3 attempts × 1 minute per activity means a failing call can take ~3 minutes
  before the workflow gives up. Consider fewer attempts for a snappier demo.
- **Answer length vs speed:** tune `STEP_MAX_WORDS` (bounded at 256 by the headroom test) together
  with `STEP_MAX_TOKENS` if fuller final answers matter more than latency.
- **Real search:** the `search` step is LLM-simulated (no internet). Anthropic's server-side web
  search tool could make it real; a scope and cost decision.
- **Cost levers not used:** prompt caching and adaptive thinking were skipped deliberately (small,
  short-lived prompts). Revisit only if spend or quality becomes a concern.
