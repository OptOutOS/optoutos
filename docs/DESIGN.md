# Design

Architecture and key decisions for OptOutOS, and — critically — the *why*
behind them. Written retroactively (2026-09-09); treat this as the living
source of truth going forward, updated whenever a real architectural
decision is made (see "Keeping this current" at the bottom).

## High-level architecture

```
packages/core     — broker registry, removal engine, PII-source abstraction,
                     multi-person household store, Playwright/FlareSolverr
                     adapters (shared by every surface)
apps/cli          — local-first CLI client (built, working)
apps/desktop      — (planned) GUI for non-technical self-hosters
apps/cloud        — (scaffolded, de-scoped) Terraform + Lambda for
                     self-hosted scheduled runs — see "Local-first pivot" below
```

One engine, one privacy-minimization gate (`runRemoval()` in
`packages/core/src/brokers/engine.ts`), multiple surfaces consuming it.

## Data flow (the core promise, end to end)

```
 1. PII source          2. Minimal search       3. Local scoring
 ┌─────────────┐        ┌──────────────┐        ┌──────────────────┐
 │ Household   │──name──▶│ Broker's own │──────▶│ scoreCandidate() │
 │ store       │  only  │ search()     │candidates│ (on-device only) │
 │ (encrypted) │        └──────────────┘        └────────┬─────────┘
 └─────────────┘                                          │
                                                  score ≥ 0.6?
                                          ┌─────────yes────┴────no──────┐
                                          ▼                             ▼
                                ┌──────────────────┐          ┌──────────────────┐
                                │ optOut() — full   │          │ no_match_found / │
                                │ PII for THIS      │          │ requires_manual_ │
                                │ candidate only    │          │ verification     │
                                └──────────────────┘          └──────────────────┘
```

The full profile **never crosses step 2** — only `searchFields` (name +
sometimes city) go to the broker's search. Steps 2→3 happen entirely
in-process; nothing is sent anywhere for scoring.

## Key decisions and their rationale

### 1. Local-first over centrally-hosted AWS SaaS
**Original plan** (first session): a Terraform+Lambda stack, each user
deploying their own AWS account.
**Pivot**: after research surfaced the Privacy Guides community's explicit
guidance that data-removal tools should run locally on the user's own
device ("the correct architecture... your PII never leaves your personal
device"), the design shifted to local-first as the default, with the
AWS/Terraform path demoted to an optional, still-self-hosted-only, opt-in
mode — never a shared/central OptOutOS-operated service. `apps/cloud`
remains scaffolded but unused; local-first proved sufficient and simpler.

### 2. Physical isolation over logical multi-tenancy
For multi-person/multi-household deployments, isolation is structural: each
household gets its own encrypted file or its own BWS secret — never rows in
a shared database gated by an access-control check. Rationale: an ACL bug is
a category of bug that simply cannot exist if there's no shared store to
leak across in the first place.

### 3. Method priority: API > form > email
Chosen because forms are the most anti-bot-fragile channel and APIs
essentially don't exist for these brokers in practice; email (formal
GDPR/CCPA-style requests) is the fallback for brokers whose forms are
Cloudflare/Turnstile-blocked, since email doesn't require clearing a
JS challenge. (Email path not yet built — see docs/REQUIREMENTS.md FR9.)

### 4. Anti-bot policy: detect and fail closed, never bypass
Any interactive CAPTCHA/Turnstile/reCAPTCHA challenge causes the adapter to
return `requires_manual_verification` rather than attempt to solve or
circumvent it. This is a hard line, not a cost/effort tradeoff — verified
repeatedly in adapter code (e.g. `advancedbackgroundchecks.ts` opt-out step
correctly refuses on reCAPTCHA even after search succeeds).

### 5. FlareSolverr + direct HTML parsing over fighting Playwright re-navigation
Passive Cloudflare "Just a moment..." JS challenges (not CAPTCHAs — no human
interaction required) are cleared via a self-hosted FlareSolverr instance.
Early attempts injected FlareSolverr's solved cookies into a fresh Playwright
context and re-navigated — this proved unreliable on some routes (documented
inconsistency: identical requests sometimes succeeded, sometimes timed out).
The reliable pattern that emerged: call FlareSolverr directly for the raw
HTML response and parse it with `cheerio`, never re-navigating with
Playwright at all for that step. This is now the reference pattern for any
future broker needing the same treatment.

### 6. Explainable, field-weighted scoring — not ML
`scoreCandidate()` is a fixed set of per-field weights (name, city, state,
zip, phone, email, relatives), normalized by which fields the broker actually
displayed. Chosen deliberately over any ML/similarity-model approach because
this is a privacy-critical gate: it must be auditable by reading the code,
not by trusting a black-box model's behavior.

### 7. No CLI framework (yargs/commander) — hand-rolled arg parsing
For a PII-handling tool, dependency surface itself is part of the threat
model (a compromised transitive dependency in `packages/core` or `apps/cli`
is a supply-chain risk to PII in memory during a run). The CLI's argument
surface is small enough that hand-rolling it was cheaper than accepting the
dependency tree of a full CLI framework.

### 8. Passphrases/tokens: environment variables only, never CLI flags
Both the local encrypted store's passphrase (`OPTOUTOS_PASSPHRASE`) and the
Bitwarden Secrets Manager token (`BWS_ACCESS_TOKEN`) are read from the
environment exclusively. A CLI flag value is visible in shell history and to
any other process via `ps`/Task Manager — an environment variable is not
(with normal OS process isolation).

## Storage backends

Two implementations of one `PeopleStore` interface
(`packages/core/src/people/store.ts`):
- `LocalEncryptedFileStore` — fully offline, AES-256-GCM, scrypt-derived key
  from a user passphrase. No passphrase recovery mechanism by design (a
  recoverable passphrase is a weaker passphrase) — see the backup-runbook gap
  noted in ROADMAP.md.
- `BitwardenSecretsPeopleStore` — delegates encryption-at-rest and backup to
  Bitwarden Secrets Manager, via the same `bws` CLI convention already used
  for the single-profile `PiiSource`.

## Broker adapter status

See `docs/BROKER_STATUS.md` for the live, per-broker, honestly-reported
status (which have working search, which are anti-bot-blocked, which are
login-gated/out of scope for automation).

## Keeping this current

When a real architectural decision is made (not just a bug fix), add it to
"Key decisions" above with the same rationale-first format. If the decision
is narrow/one-off rather than structural, a lighter-weight ADR entry (see
`docs/adr/`, to be created if this pattern proves useful) may fit better than
expanding this file indefinitely.
