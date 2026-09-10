# Roadmap

Where OptOutOS actually stands, and what's next. Updated 2026-09-09 (Round
8 — post Rslint migration + scheduling/logging). This is an honesty
document, not a marketing one — see "MVP definition" below for why this
project is **not yet an MVP**, despite substantial working infrastructure.

## MVP definition (what "done" looks like for v0.1)

An MVP for a data-broker removal tool means: a non-technical-ish user can
install it, add themselves, and have it **actually search AND remove** their
data from a meaningful fraction of the 12 target brokers, unattended,
repeatably. Concretely:

- [ ] Real working `search()` for **at least half** (6+/12) of the target
      brokers (currently: **3/12** — `advancedbackgroundchecks`, `spokeo`,
      `usphonebook`).
- [ ] At least one **successful, verified, real removal submission** end to
      end (currently: **zero** — every path either has no confirmed match to
      gate on, or correctly refuses at an active CAPTCHA/reCAPTCHA/account-
      gate step).
- [ ] Email-based removal path built (currently: not started) — demoted to
      last resort per the revised anti-bot policy (see below), since a
      real-browser solver now covers most Cloudflare/Turnstile blocks.
- [x] Scheduled/recurring runs — ✅ done (2026-09-09). `schedule-run` CLI
      command, per-broker cadence (default 100 days, cited from
      privacyguides.org), non-PII JSONL audit log. See docs/SCHEDULING.md.
- [ ] A packaged install path that isn't "clone the repo and run npm build"
      (currently: developer-only).

**Current honest status: working spike / pre-alpha with a hardened core.**
The trust-critical foundation (privacy-minimization gate, encrypted
multi-person storage, anti-bot solver integration, scheduling/logging, TDD
discipline, CI/security hygiene) is genuinely solid — but the actual removal
outcomes a user would judge this tool on don't exist yet for most brokers.

## What's built and verified (as of 2026-09-09, Round 8)

- `packages/core`: broker registry (12 adapters, honestly-reported status),
  removal engine with the privacy-minimization gate, multi-person encrypted
  household store with relationship-aware scoring, FlareSolverr integration,
  **Turnstile/CAPTCHA solver integration** (`turnstile-solver.ts` +
  `turnstile-page-helper.ts`, live-verified against a real self-hosted
  EzSolver instance; wired into the That'sThem adapter as the reference
  integration), **real search-result parsing for 3 brokers**
  (`advancedbackgroundchecks`, `spokeo`, `usphonebook`),
  **recurring-run scheduling + non-PII audit logging**
  (`scheduling/`, `logging/run-logger.ts`; per-broker `lastRunAt` rollup
  lives inside the encrypted `PersonRecord`, not a second unencrypted
  store — see docs/SCHEDULING.md).
- `apps/cli`: `list-brokers`, `run` (profile-file or household-backed,
  dry-run by default), `person add/edit/list/link`, `schedule-run`
  (`--store`, `--broker`, `--execute`).
- **Tooling**: linting migrated from ESLint + `@typescript-eslint` to
  **Rslint** (`@rslint/core`) after TypeScript 7.0's Go-based rewrite broke
  `@typescript-eslint` compatibility outright (no support exists as of
  2026-09; see CONTRIBUTING.md and `rslint.shared.ts`'s header comment for
  the migration pitfalls — a shared config referenced cross-directory
  silently drops type-aware rules with no error). CI runs on Node 22
  (Rslint needs >=22.6 for native `.ts` config loading).
- CI/security: branch protection, Dependabot, secret scanning, CodeQL, all
  free-tier GitHub features, **167 tests passing** (117 core + 50 CLI).
- Governance docs: README, THREAT_MODEL (incl. ToS risk note and the revised
  anti-bot policy), SECURITY, CONTRIBUTING, REQUIREMENTS, DESIGN,
  BROKER_STATUS (8 verification rounds), FLARESOLVERR, PEOPLE_STORE,
  SCHEDULING.

## Immediate next steps (in priority order, revised 2026-09-09, Round 8)

1. **Extend the Turnstile solver to more brokers** — it's proven working
   (live-verified against a real EzSolver instance) and wired into
   That'sThem, but That'sThem's live site currently returns a flat
   CloudFront 403 before reaching the Turnstile challenge, so a full live
   proof against a *real* broker page is still pending. A live re-survey
   (BROKER_STATUS.md Round 5) found the other blocked brokers are actually
   IP-banned (Whitepages, CheckPeople) or now account-gated (BeenVerified) —
   neither is a problem the solver can fix. **Re-check That'sThem's
   CloudFront block periodically**, or find a broker with a clean,
   currently-live interactive-Turnstile-only gate as the next real proof
   target.
2. **USPhonebook search parsing** — ✅ done (2026-09-09, Round 7). Real
   search now works for all 3 brokers previously known to be
   FlareSolverr/browser-reachable.
3. **Thread a matched `candidateId` from `search()` into `optOut()`** — a
   real, not-yet-designed change to the `runRemoval()`/engine interface.
   Needed for Spokeo (which requires a broker-issued per-listing URL for
   opt-out) and would generalize to any broker with the same shape.
   Spokeo's `/optout` page itself is currently a flat 403 (Round 8, not a
   solver-fixable challenge) — **hold this work until the page is
   verifiably reachable again**, per an explicit decision not to guess
   selectors against an inaccessible page.
4. **A first real, verified removal submission** — needed to prove the full
   loop works, not just the search+scoring half. Requires either the
   solver to clear an opt-out-page challenge, or the candidateId-threading
   work above for a broker whose opt-out doesn't have an anti-bot gate at
   all.
5. **Scheduling** — ✅ done (2026-09-09). `schedule-run` CLI command,
   per-broker cadence tracked via a compact rollup on PersonRecord, a
   separate non-PII JSONL audit log, and docs/SCHEDULING.md covering
   cron/Task Scheduler setup.
6. **Email-based removal path** — last-resort fallback for brokers where no
   technical bypass path exists at all (e.g. IP-banned, or account-gated
   like BeenVerified where creating a third-party account is out of scope).

## Deferred / explicitly out of scope for now

- `apps/desktop` GUI — not started, no timeline.
- `apps/cloud` Terraform/AWS deployment — scaffolded then de-scoped after
  the local-first pivot (see DESIGN.md #1); revisit only if real demand for
  unattended cloud scheduling emerges that a local cron job can't satisfy.
- Passphrase recovery for `LocalEncryptedFileStore` — deliberately absent
  (see DESIGN.md), but the backup/rotation *runbook* for users is not yet
  written. Should exist before recommending this to anyone non-technical.
- Packaged distribution (npm publish, binary, Docker image).
- **Account-gated brokers (BeenVerified)** — no policy exists yet for
  whether/how OptOutOS should ever handle a broker that requires the user's
  own account login to reach opt-out. Currently out of scope entirely
  (fails closed); would need an explicit policy decision, not just code,
  before any work here.

## Process gaps worth closing (not code, but real risk)

Tracked as GitHub issues (label: `backlog`) rather than left as prose here —
see https://github.com/OptOutOS/optoutos/issues?q=is%3Aopen+label%3Abacklog
for the current live list. As of 2026-09-10:

- [#7](https://github.com/OptOutOS/optoutos/issues/7) Recheck Spokeo
  `/optout` reachability; unhold candidateId threading.
- [#8](https://github.com/OptOutOS/optoutos/issues/8) First real, verified
  end-to-end broker removal submission.
- [#9](https://github.com/OptOutOS/optoutos/issues/9) Email-based removal
  path (last-resort fallback).
- [#10](https://github.com/OptOutOS/optoutos/issues/10) Autonomous/
  background work has no delivery guarantee to `main` — found 2026-09-10
  when 20 orphaned git worktrees (2 with real unmerged work) turned up
  never pushed or reported.

Other standing risks, not yet worth their own issue:

- **Legal/ToS risk**: scraping broker sites for opt-out purposes likely
  violates their Terms of Service even when the intent is benign. Written
  down as an accepted risk in THREAT_MODEL.md.
- **Versioning/release policy**: no CHANGELOG, no semver tags, no publish
  plan. Fine at pre-alpha; will matter once anyone besides the maintainer
  installs this.
- **Decision log / ADRs**: DESIGN.md's "Key decisions" section works for
  now: if the volume of one-off narrower decisions grows, consider
  lightweight per-decision ADR files instead of one growing document.
- **Dependency-version drift between sub-packages**: `apps/cli` and
  `packages/core` each had their own `devDependencies` and drifted out of
  sync across several PRs (TypeScript, ESLint, `@types/node` ranges
  diverged). Fixed 2026-09-09 by moving shared devDependencies to the root
  `package.json`. Lesson: after any dependency bump, do a genuinely clean
  reinstall (`rm -rf node_modules package-lock.json && npm install`)
  before trusting the result — a reused lockfile can mask a real
  `ERESOLVE` conflict (this is exactly how the TypeScript 7 / Rslint issue
  above was discovered).
