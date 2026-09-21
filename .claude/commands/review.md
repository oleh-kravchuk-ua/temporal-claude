# /review

Review the current git diff for code quality and issues.

## Steps

1. Read all source files in `src/`.
2. Check for **security issues**: unsanitized inputs, missing auth checks, exposed secrets.
3. Check for **performance issues**: N+1 queries, missing indexes, unbounded loops, memory leaks.
4. Check for **code style**: inconsistent naming, missing error handling, dead code, missing types.
5. Output a structured summary:

## Checklist

Analyze the staged changes and provide findings for:

1. **Security Vulnerabilities** — Any potential security issues:
   - Hardcoded secrets, API keys, credentials
   - SQL injection risks or unsafe query patterns
   - XSS vulnerabilities in DOM manipulation
   - CSRF token handling
   - Authentication/authorization bypasses
   - Input validation gaps

2. **Performance Issues** — Optimization opportunities:
   - Unnecessary loops or nested operations
   - Missing memoization or caching
   - Database query inefficiencies
   - Large bundle size increases
   - N+1 query problems
   - Missing indexes or poor algorithm choices

3. **Missing Error Handling** — Exception coverage gaps:
   - Unhandled promise rejections
   - Missing try/catch blocks
   - No null/undefined checks
   - Graceful degradation for edge cases
   - Missing timeout handling

4. **Test Coverage Gaps** — Testing deficiencies:
   - New functions or methods without tests
   - Edge cases not covered
   - Missing integration or E2E tests
   - Untested error paths
   - Low coverage percentage for critical paths

## Severity levels

- **CRITICAL** — Must fix before merge (security, data loss risk)
- **HIGH** — Should fix before merge (significant performance/UX impact)
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

### Code Style
| Severity | File | Issue | Suggestion |
|----------|------|-------|------------|
| ...      | ...  | ...   | ...        |

### Overall: PASS / NEEDS ATTENTION
```

## Notes

- Severity levels: CRITICAL, HIGH, MEDIUM, LOW
- If no issues found in a category, say "No issues found, this is safe to merge" or or "Notes: Recommend changes before merge"
- Be specific about file paths and line numbers
