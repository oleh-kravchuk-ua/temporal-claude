# /verify

Run tests and lint, then summarize results.

## Steps

1. Run `npm test` and capture the output.
2. Run `npm run lint` and capture the output.
3. Summarize results in this format:

```
## Verification Summary
- Tests: PASS / FAIL (X passed, Y failed)
- Lint: PASS / FAIL (X errors, Y warnings)
- Issues: [list any failures with file paths and suggested fixes]
```

## Success Criteria

All tests pass and zero lint errors. If anything fails, suggest specific fixes.
