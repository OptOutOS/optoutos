# Contributing to OptOutOS

## Required workflow: Test-Driven Development

All new code (features, bug fixes, adapter changes) must follow strict
TDD — see the project's `test-driven-development` discipline:

1. **RED** — write a test for the new behavior first. Run it. Watch it fail
   for the right reason (missing feature, not a typo).
2. **GREEN** — write the minimal code to make it pass. Run it. Confirm it
   passes and nothing else broke (`npm test` from repo root).
3. **REFACTOR** — clean up with tests staying green throughout.

**No production code without a failing test first.** This applies especially
to `packages/core/src/brokers/engine.ts` and `matching.ts` — the
privacy-minimization gate is the single most safety-critical part of this
project. A weakened `MATCH_CONFIDENCE_THRESHOLD` or a bypassed
search-before-optout check is a privacy regression, not just a bug.

Exceptions (ask a maintainer first): throwaway prototypes/spikes,
config-only changes.

## Before opening a PR

```bash
npm install         # from repo root
npm run lint         # Rslint, must be clean
npm run typecheck    # tsc --noEmit, must be clean
npm run build        # must succeed
npm test             # all tests must pass
```

CI (`.github/workflows/ci.yml`) runs all four on every push/PR — a failing
check blocks merge.

## Broker adapter changes

Any change to a `packages/core/src/brokers/*.ts` adapter must be backed by
**live verification**, not assumed selectors:

- Never guess a CSS selector, field name, or result structure you haven't
  personally observed on the live site.
- If a broker is protected by an interactive CAPTCHA/Turnstile challenge, do
  not attempt to bypass it — detect it and fail closed to
  `requires_manual_verification`. See `THREAT_MODEL.md` and
  `docs/FLARESOLVERR.md` for the project's anti-bot policy.
- Document what you verified and when, directly in the adapter's docstring.

## Code style

- TypeScript, strict mode. Rslint (typescript-go native, ESLint-compatible
  flat config, replaces ESLint + @typescript-eslint — see rslint.shared.ts)
  + Prettier enforced in CI.
- No `any` without a `// eslint-disable-next-line` comment explaining why
  (Rslint understands ESLint-style disable comments).
- PII is never logged. Loggers/evidence objects must not contain raw PII
  fields — see `SECURITY.md`.
