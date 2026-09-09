# Roadmap

Where OptOutOS actually stands, and what's next. Updated 2026-09-09. This is
an honesty document, not a marketing one — see "MVP definition" below for
why this project is **not yet an MVP**, despite substantial working
infrastructure.

## MVP definition (what "done" looks like for v0.1)

An MVP for a data-broker removal tool means: a non-technical-ish user can
install it, add themselves, and have it **actually search AND remove** their
data from a meaningful fraction of the 12 target brokers, unattended,
repeatably. Concretely:

- [ ] Real working `search()` for **at least half** (6+/12) of the target
      brokers (currently: 1/12 — `advancedbackgroundchecks`).
- [ ] At least one **successful, verified, real removal submission** end to
      end (currently: **zero** — every path either has no search to gate on,
      or correctly refuses at the CAPTCHA/reCAPTCHA step).
- [ ] Email-based removal path built (currently: not started) — likely the
      biggest unlock, since 7/12 brokers are anti-bot-blocked on web forms.
- [ ] Scheduled/recurring runs (currently: none — CLI is invoke-once).
- [ ] A packaged install path that isn't "clone the repo and run npm build"
      (currently: developer-only).

**Current honest status: working spike / pre-alpha with a hardened core.**
The trust-critical foundation (privacy-minimization gate, encrypted
multi-person storage, anti-bot refusal policy, TDD discipline, CI/security
hygiene) is genuinely solid — but the actual removal outcomes a user would
judge this tool on don't exist yet for most brokers.

## What's built and verified (as of 2026-09-09)

- `packages/core`: broker registry (12 adapters, honestly-reported status),
  removal engine with the privacy-minimization gate, multi-person encrypted
  household store with relationship-aware scoring, FlareSolverr integration.
- `apps/cli`: `list-brokers`, `run` (profile-file or household-backed,
  dry-run by default), `person add/edit/list/link`.
- CI/security: branch protection, Dependabot, secret scanning, CodeQL, all
  free-tier GitHub features, 112 tests passing.
- Governance docs: README, THREAT_MODEL, SECURITY, CONTRIBUTING,
  REQUIREMENTS, DESIGN (this set), BROKER_STATUS, FLARESOLVERR, PEOPLE_STORE.

## Immediate next steps (in priority order, per most recent review)

1. **Email-based removal path.** Highest leverage: unblocks brokers no
   amount of Playwright/FlareSolverr engineering can, since 7/12 are
   Cloudflare/Turnstile-blocked on their web forms specifically.
2. **Spokeo / USPhonebook search parsing.** Apply the proven
   FlareSolverr-raw-HTML + cheerio pattern (see DESIGN.md decision #5) to
   the other 2 brokers already known to be reachable via FlareSolverr.
3. **A first real, verified removal submission** on whichever broker's
   opt-out step doesn't hit an active CAPTCHA — needed to prove the full
   loop works, not just the search+scoring half.
4. **Scheduling** — even a simple documented cron/Task-Scheduler recipe
   using the existing CLI would meet this need without new code.

## Deferred / explicitly out of scope for now

- `apps/desktop` GUI — not started, no timeline.
- `apps/cloud` Terraform/AWS deployment — scaffolded then de-scoped after
  the local-first pivot (see DESIGN.md #1); revisit only if real demand for
  unattended cloud scheduling emerges that a local cron job can't satisfy.
- Passphrase recovery for `LocalEncryptedFileStore` — deliberately absent
  (see DESIGN.md), but the backup/rotation *runbook* for users is not yet
  written. Should exist before recommending this to anyone non-technical.
- Packaged distribution (npm publish, binary, Docker image).

## Process gaps worth closing (not code, but real risk)

- **Legal/ToS risk**: scraping broker sites for opt-out purposes likely
  violates their Terms of Service even when the intent is benign. This is
  an accepted risk today but has never been written down as such — belongs
  as a short paragraph in THREAT_MODEL.md.
- **Versioning/release policy**: no CHANGELOG, no semver tags, no publish
  plan. Fine at pre-alpha; will matter once anyone besides the maintainer
  installs this.
- **Decision log / ADRs**: DESIGN.md's "Key decisions" section works for
  now: if the volume of one-off narrower decisions grows, consider
  lightweight per-decision ADR files instead of one growing document.
