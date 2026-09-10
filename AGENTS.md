# OptOutOS - Development Guide

Instructions for AI coding assistants (and humans) working on this repo.
Modeled on the `AGENTS.md` convention from
[hermes-agent](https://github.com/NousResearch/hermes-agent/blob/main/AGENTS.md),
scaled down to this project's actual size — one root file, no per-area
split yet (revisit if this file starts getting skimmed instead of read).

## What OptOutOS Is

A FOSS, local-first, privacy-first engine that removes an individual's
personal data from data-broker/people-search sites. AGPL-3.0. Self-hosted
by each user (no central service holding anyone's PII). Monorepo:
`packages/core` (shared engine — broker registry, removal engine, PII
handling, encrypted household store, adapters), `apps/cli`, `apps/web`
(Hono, local-only GUI). See `docs/DESIGN.md` for the full architecture and
the decision log; see `docs/ROADMAP.md` for current status and priorities.

Two invariants shape almost every design decision here:

- **The privacy-minimization gate (`runRemoval()` in
  `packages/core/src/brokers/engine.ts`) is sacred.** A removal request
  must never be sent to a broker unless a local-only, on-device match was
  confirmed first (score ≥ `MATCH_CONFIDENCE_THRESHOLD`). Search uses the
  minimal PII fields; only a confirmed match unlocks the fuller PII needed
  to actually submit. Any change that lets `optOut()` get called without
  going through this gate is a hard regression, not a style nit.
- **The repo does not and will not contain PII.** Test fixtures use
  synthetic identities (Zaphod Beeblebrox, John Smith) or your own
  data if you explicitly choose to test with it locally — never commit
  real captured PII, even redacted-looking, to this repo. This applies to
  chat/session output too when working in an AI agent session.

## Layering rule (apps must not depend on apps)

`apps/cli` and `apps/web` must depend ONLY on `packages/core`, never on
each other. When a feature the web GUI needs already exists in the CLI
(household mutation commands, broker registry), MOVE that logic into
`packages/core` and have both apps import it from there — don't
re-implement it in the second app or import across apps directly. This
happened twice already (`person-commands.ts`, `brokers/registry.ts`) —
check for the same pattern before adding new cross-app functionality.

## Contribution Rubric

### What we want

- **Fix real bugs, well.** Reproduce against the live broker or a real
  captured fixture, point to the exact failure, fix the actual class of
  bug — not just the symptom that was reported. CheckPeople's no-match
  detector looked fixed after testing against a synthetic empty query;
  it wasn't sound until tested against a real common name too (see
  "Verification discipline" below).
- **Expand broker coverage, including hard brokers.** Per the scope
  policy (issue #11, closed): no broker is ever dropped from the roadmap
  for having an unusual shape (account-gating, email-only confirmation,
  paywalled results, real reCAPTCHA). Deprioritize by implementation
  effort; never permanently exclude.
- **Real live verification over green mocks.** Anything touching a
  broker's actual search/opt-out flow, the encrypted store's
  read/write path, or the web GUI's HTTP surface must be exercised for
  real — a real HTTP round-trip against the compiled server, a real
  temp encrypted file, a real (or captured-and-replayed) broker page —
  not just a mocked unit test. Unit tests alone have missed real bugs
  here more than once (the Fastify→Hono swap; a wrong passphrase
  silently "succeeding" against an existing encrypted store).
- **Behavior contracts over snapshots.** A test should assert a
  relationship ("this detector returns false for both an empty query
  AND a real common name"), not freeze a value that's expected to
  change.
- **Keep docs synced in the same PR.** `docs/*.md` is the source of
  truth; the GitHub wiki is a separate clone that drifts independently
  and has gone a full day+ stale before. Moving/renaming a broker's
  status, closing an issue, or shipping a GUI slice means updating
  `docs/ROADMAP.md` / `docs/BROKER_STATUS.md` and (at session
  wrap-up, not necessarily every commit) the wiki.

### What we don't want

- **Removal submitted without a confirmed match.** No exception, no
  "just this once for testing" — this is the one rule the whole
  engine exists to enforce. Testing against your own real household
  data with dry-run mode is fine and encouraged; testing `optOut()`
  against a broker without a genuine match is not.
- **Paid third-party CAPTCHA-solving services**, even on their free
  tiers (2Captcha, CapSolver, Scrappey, etc.). Self-hosted, real-browser,
  locally-run solvers only (Turnstile via EzSolver-style; reCAPTCHA v2
  image/audio puzzle-solving is policy-approved but no compliant
  automatable option has been found yet — see issue #12). See
  `THREAT_MODEL.md` for the full anti-bot vs. paywall-bypass policy
  split.
- **Bypassing a payment paywall without the explicit opt-in.** A
  payment paywall is the broker's own product, not an anti-bot filter —
  treated as a materially different category (`RunRemovalOptions.
  allowPaywallBypass`, off by default, single global env toggle, never
  a per-run flag). See DESIGN.md decision #11.
- **A detector "verified" against only a synthetic empty-match query.**
  Any HTML-based match/no-match detector must be validated against BOTH
  a guaranteed-empty query AND a real/common-name query before being
  called sound — CheckPeople's detector shipped, then was proven unsound,
  by exactly this gap.
- **Hand-editing a captured test fixture to "fix" a CodeQL finding**
  without checking whether the fixture is load-bearing for real parser
  coverage first. Prefer excluding the fixture directory from the
  relevant scanner via config over silently trimming content a real test
  depends on.

## Verification discipline (non-negotiable)

- A "clean install" claim means a REAL `rm -rf node_modules
  package-lock.json` + fresh `npm install`, not a reused lockfile — a
  stale lockfile hid a real TypeScript 7 / `@typescript-eslint`
  incompatibility for a full round once.
- After any change: `npm run lint && npm run typecheck && npm run build
  && npm test` in EACH of `packages/core`, `apps/cli`, `apps/web` — not
  just the package you touched, since `packages/core` changes ripple
  into both apps.
- TDD is expected: write the failing test, confirm RED, then implement,
  confirm GREEN.
- New dependencies get checked for recent CVEs/advisories (not just
  "does `npm install` succeed") before being pinned — both
  `@fastify/static` and later `hono`/`@hono/node-server` had real
  recent path-traversal CVEs; pin to a version past the fix, not
  "latest".

## Broker adapters

Read `docs/ADAPTER_GUIDE.md` before writing or modifying a broker
adapter — it documents the three proven scraping patterns this repo
actually uses (direct Playwright, FlareSolverr raw-HTML + cheerio,
Turnstile solver), the anti-bot-vs-paywall distinction, and the
verification discipline specific to adapters. Read `docs/BROKER_STATUS.md`
for the current live-verified status of every broker before assuming a
finding is still true — broker postures drift (Spokeo went from
`/optout`-only 403 to a domain-wide block between rounds; CheckPeople's
reachability finding reversed between rounds).

## Web GUI (`apps/web`)

Local-only (binds `127.0.0.1` only, never `0.0.0.0` — no remote-access
mode). Hono (not Fastify — see DESIGN.md decision #12 for the framework
comparison). Unlock is BWS-backed as the primary path, in-memory
passphrase prompt as the fallback; see `packages/core/src/web/unlock.ts`.
Any route that reads/writes the household store must go through the
same locked/unlocked gate as the existing routes
(`resolveHouseholdStore()` in `apps/web/src/server.ts`) — there is no
"trusted" caller that skips it.

## CI

`.github/workflows/ci.yml` runs one job per package (`core`, `cli`,
`web`) — all three are required status checks on `main`'s branch
protection. If you add a new `apps/*` or `packages/*` package, add its CI
job AND its required-status-check context in the same PR — `apps/web`
went unmonitored by CI for its first four merges to `main` because this
step was missed when the package was created.

## Kanban board (`optoutos`)

`kanban.dispatch_in_gateway` is deliberately kept `false` for cost
control — a standing decision, not an oversight. Verify it is still
`false` before assuming dispatch is idle; it has silently reverted to
`true` before. Workers must use `request-review`, never
`kanban_complete` directly — a human does the merge, full clean-install
verification, and push.

## Project Structure

```
optoutos/
├── packages/core/     — shared engine: brokers/, people/, pii.ts, scheduling/,
│                        logging/, web/ (unlock), flaresolverr.ts
│   └── src/brokers/__fixtures__/  — captured real-site HTML, cheerio parser tests
│                                     only (excluded from CodeQL — .github/codeql-config.yml)
├── apps/cli/          — local-first CLI client
├── apps/web/           — local-only web GUI (Hono; public/ = vanilla-JS frontend)
├── docs/               — source of truth: DESIGN.md, ROADMAP.md, BROKER_STATUS.md,
│                          ADAPTER_GUIDE.md, SCHEDULING.md, REQUIREMENTS.md
├── THREAT_MODEL.md     — anti-bot policy, paywall-bypass policy, hard lines
└── .github/
    ├── workflows/ci.yml        — lint/typecheck/build/test per package
    ├── workflows/codeql.yml    — advanced CodeQL setup (not GitHub's config-less default)
    └── codeql-config.yml       — paths-ignore for captured fixtures
```

The GitHub wiki (`optoutos.wiki`, separate git remote) is a human-facing
summary of `docs/` — check it for staleness at session wrap-up, it drifts
independently and is not auto-synced.

## Linting

Rslint (`@rslint/core`), not ESLint/`@typescript-eslint` — TypeScript
7.0's Go-based compiler broke `@typescript-eslint` compatibility outright.
Each package has its own `rslint.config.ts` co-located with its own
`tsconfig.json` and importing shared rules from root `rslint.shared.ts` —
a root-level config referencing files across package directories
silently drops type-aware rules with no warning (verified: 66/69 vs
69/69 rules with an injected violation). Don't consolidate configs across
packages.
