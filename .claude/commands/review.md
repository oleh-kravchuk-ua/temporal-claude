# /review

Review the current git diff for code quality and issues, for this project's actual stack:
**Fastify HTTP API + Temporal TypeScript SDK workflow, Vitest, zod at the edges, pino
logging.** No database, no DOM/frontend, no session-based auth — skip checklist items that
don't apply to that shape rather than forcing a generic web-app checklist onto it.

## Steps

1. Read the current git diff (or all of `src/` if reviewing the whole codebase).
2. Check for security issues relevant to this stack (see checklist).
3. Check for performance issues relevant to this stack.
4. Check for error-handling and determinism issues specific to Temporal workflow code.
5. Check for test coverage gaps, accounting for Temporal's workflow sandbox (see Notes).
6. Output a structured summary.

## Checklist

1. **Security** — potential issues:
   - Zod validation missing at an HTTP/signal/query boundary (request body, params, signal
     payload)
   - Secrets (Temporal Cloud API key, etc.) hardcoded, logged, or leaking through an
     unredacted error path — check `pino`'s `redact` config covers the actual leak surface,
     not just the happy-path field names
   - CORS/security headers misconfigured (`@fastify/cors`, `@fastify/helmet`)
   - Missing authorization/ownership check on a workflow-id-scoped endpoint (IDOR-style)
   - Unauthenticated, unbounded endpoints that could be abused for resource exhaustion (no
     rate limiting) — especially anything that starts a new workflow

2. **Performance** — optimization opportunities:
   - Unbounded loops or recursion (this app has none by design — flag any new one)
   - Blocking/synchronous work inside a workflow or activity handler
   - Repeated/redundant calls to the Temporal Client from a single HTTP request

3. **Error handling & determinism** — Temporal-specific correctness, not generic
   try/catch coverage:
   - A process entrypoint (worker/API/CLI) that catches an error without setting
     `process.exitCode`/rethrowing, silently reporting success to the supervisor on failure
   - Non-deterministic calls (`Date.now()`, `Math.random()`, direct I/O) inside workflow
     code — must go through activities instead
   - Workflow code using `console.log`/pino directly instead of `@temporalio/workflow`'s
     `log` (breaks replay determinism)
   - Signal/query handlers that are async, sleep, or call activities (they must stay
     synchronous)
   - Zod-invalid signal payloads that aren't safely ignored/logged (a signal can't fail the
     sender)

4. **Test coverage gaps** — testing deficiencies:
   - New functions/branches without tests
   - Untested error paths
   - **Not a gap:** `workflow/agent-run.ts` and `workflow/agent.workflow.ts` run inside
     Temporal's isolated workflow sandbox, which `v8` coverage cannot instrument regardless
     of how thoroughly they're tested — low % there is expected (see `vitest.config.ts`'s
     `coverage.exclude`). Verify these via `agent.workflow.test.ts`'s scenarios, not the
     coverage number. Entrypoints (`worker.ts`, `http/server.ts`, `cli/client.ts`) are
     intentionally verified via manual live smoke (`docs/PLAYBOOK.md`), not unit tests.

## Severity levels

- **CRITICAL** — Must fix before merge (security, data loss risk)
- **HIGH** — Should fix before merge (significant correctness/performance impact)
- **MEDIUM** — Fix soon (code quality, maintainability)
- **LOW** — Nice to have (minor improvements, style)

## Output Format

For each finding, provide:

- The specific line(s) or function affected
- Why it's a concern (show the issue)
- Suggested fix (if applicable)

## Summary

```zsh
## Code Review Summary

### Security
| Severity | File | Issue | Suggestion |
|----------|------|-------|------------|
| ...      | ...  | ...   | ...        |

### Performance
| Severity | File | Issue | Suggestion |
|----------|------|-------|------------|
| ...      | ...  | ...   | ...        |

### Error Handling & Determinism
| Severity | File | Issue | Suggestion |
|----------|------|-------|------------|
| ...      | ...  | ...   | ...        |

### Overall: PASS / NEEDS ATTENTION
```

## Notes

- If no issues found in a category, say so plainly ("No issues found, this is safe to
  merge").
- This is a demo/test project with no auth layer by design — flag scope-relevant findings
  (e.g. unauthenticated endpoints) explicitly as accepted scope rather than blocking on them,
  unless the diff itself changed that scope.
- Be specific about file paths and line numbers.
