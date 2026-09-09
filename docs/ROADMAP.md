# Roadmap

Where OptOutOS actually stands, and what's next. Updated 2026-09-09 (Round
6). This is an honesty document, not a marketing one — see "MVP definition"
below for why this project is **not yet an MVP**, despite substantial
working infrastructure.

## MVP definition (what "done" looks like for v0.1)

An MVP for a data-broker removal tool means: a non-technical-ish user can
install it, add themselves, and have it **actually search AND remove** their
data from a meaningful fraction of the 12 target brokers, unattended,
repeatably. Concretely:

- [ ] Real working `search()` for **at least half** (6+/12) of the target
      brokers (currently: **2/12** — `advancedbackgroundchecks`, `spokeo`).
- [ ] At least one **successful, verified, real removal submission** end to
      end (currently: **zero** — every path either has no confirmed match to
      gate on, or correctly refuses at an active CAPTCHA/reCAPTCHA/account-
      gate step).
- [ ] Email-based removal path built (currently: not started) — demoted to
      last resort per the revised anti-bot policy (see below), since a
      real-browser solver now covers most Cloudflare/Turnstile blocks.
- [ ] Scheduled/recurring runs (currently: none — CLI is invoke-once).
- [ ] A packaged install path that isn't "clone the repo and run npm build"
      (currently: developer-only).

**Current honest status: working spike / pre-alpha with a hardened core.**
The trust-critical foundation (privacy-minimization gate, encrypted
multi-person storage, anti-bot solver integration, TDD discipline,
CI/security hygiene) is genuinely solid — but the actual removal outcomes a
user would judge this tool on don't exist yet for most brokers.

## What's built and verified (as of 2026-09-09, Round 6)

- `packages/core`: broker registry (12 adapters, honestly-reported status),
  removal engine with the privacy-minimization gate, multi-person encrypted
  household store with relationship-aware scoring, FlareSolverr integration,
  **Turnstile/CAPTCHA solver integration** (`turnstile-solver.ts` +
  `turnstile-page-helper.ts`, live-verified against a real self-hosted
  EzSolver instance; wired into the That'sThem adapter as the reference
  integration), **real search-result parsing for 2 brokers**
  (`advancedbackgroundchecks`, `spokeo`).
- `apps/cli`: `list-brokers`, `run` (profile-file or household-backed,
  dry-run by default), `person add/edit/list/link`.
- CI/security: branch protection, Dependabot, secret scanning, CodeQL, all
  free-tier GitHub features, **135 tests passing** (90 core + 45 CLI).
- Governance docs: README, THREAT_MODEL (incl. ToS risk note and the revised
  anti-bot policy), SECURITY, CONTRIBUTING, REQUIREMENTS, DESIGN,
  BROKER_STATUS (6 verification rounds), FLARESOLVERR, PEOPLE_STORE.

## Immediate next steps (in priority order, revised 2026-09-09, Round 6)

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
2. **USPhonebook search parsing** — the one remaining broker known to be
   FlareSolverr-reachable that hasn't had the ABC/Spokeo cheerio-parsing
   pattern applied yet. Its name-search flow has non-standard field
   behavior (city field disabled until an unidentified client-side
   interaction; Enter key doesn't submit) that needs dedicated
   investigation, not a quick copy-paste of the existing pattern.
3. **Thread a matched `candidateId` from `search()` into `optOut()`** — a
   real, not-yet-designed change to the `runRemoval()`/engine interface.
   Needed for Spokeo (which requires a broker-issued per-listing URL for
   opt-out) and would generalize to any broker with the same shape.
4. **A first real, verified removal submission** — needed to prove the full
   loop works, not just the search+scoring half. Requires either the
   solver to clear an opt-out-page challenge, or the candidateId-threading
   work above for a broker whose opt-out doesn't have an anti-bot gate at
   all.
5. **Scheduling** — even a simple documented cron/Task-Scheduler recipe
   using the existing CLI would meet this need without new code.
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

- **Legal/ToS risk**: scraping broker sites for opt-out purposes likely
  violates their Terms of Service even when the intent is benign. Written
  down as an accepted risk in THREAT_MODEL.md.
- **Versioning/release policy**: no CHANGELOG, no semver tags, no publish
  plan. Fine at pre-alpha; will matter once anyone besides the maintainer
  installs this.
- **Decision log / ADRs**: DESIGN.md's "Key decisions" section works for
  now: if the volume of one-off narrower decisions grows, consider
  lightweight per-decision ADR files instead of one growing document.
- **No reusable internal skill/reference yet for the FlareSolverr +
  Turnstile-solver workflow** — this session repeatedly re-derived the same
  setup steps (venv, Playwright Chromium reuse, `TS_PROFILE_DIR` Windows
  path gotcha, raw-fetch-then-cheerio pattern) from scratch across multiple
  turns. Worth extracting into a project-local `docs/` runbook or an
  assistant-side skill so future sessions don't re-discover the same
  pitfalls (see Context Recovery notes for a new session, below, and the
  session retrospective for the specific gap identified 2026-09-09).
