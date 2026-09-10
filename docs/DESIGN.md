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
apps/web          — local-only web GUI (Hono; built, working — unlock,
                     household management, broker-status dashboard)
apps/desktop      — (planned) native wrapper, deferred in favor of the
                     web GUI (see "Web GUI" decision below)
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

### 3. Method priority: form/bypass > API > email (revised 2026-09-09)
**Original policy**: API > form > email, with email as the fallback for
anti-bot-blocked forms.
**Revised**: since anti-bot bypass is now in scope (see decision #4), a
broker's own web form — with a real-browser CAPTCHA/Turnstile solver used
where needed — is preferred over email whenever technically viable. Email
(formal GDPR/CCPA-style requests) is now the **last resort**, used only when
no technical path (API, or form with/without anti-bot solving) exists at
all. APIs remain preferred over forms when a broker happens to expose one
(none of the 12 target brokers do, in practice).

### 4. Anti-bot policy: bypass with a real solver when available (revised 2026-09-09)
**Original policy**: never attempt to solve or bypass any active CAPTCHA/
Turnstile/reCAPTCHA challenge, full stop — fail closed to
`requires_manual_verification` unconditionally.
**Revised**: bypass anti-bot challenges using a real-browser-based,
locally-run solver (e.g. a self-hosted EzSolver- or Theyka/Turnstile-Solver-
style HTTP service, same pattern as FlareSolverr) when one is available and
working. **Still forbidden**: any third-party paid CAPTCHA-solving API
(2Captcha, CapSolver, Scrappey, etc.) — sending the challenge/traffic to an
external company reintroduces exactly the third-party-trust problem this
project exists to avoid. **Still required**: if no working solver exists for
a given challenge type, fail closed to `requires_manual_verification` —
never guess, never fabricate, never retry indefinitely.
Rationale: the live broker survey found 7 of 12 target brokers blocked
specifically by Cloudflare/Turnstile anti-bot — by far the largest blocker
category. The original hard line meant most brokers were permanently capped
regardless of adapter engineering effort. See THREAT_MODEL.md "Anti-bot /
CAPTCHA policy" for the full rationale and the distinction from bulk/
malicious scraping.

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

### 9. Kanban worker profiles must request review, never self-complete
(2026-09-10)
The `optoutos` Hermes kanban board runs a multi-role pipeline
(`optoutos-orchestrator` / `-dev` / `-secops` / `-docs`) to work through the
12-broker backlog, deliberately **paused between sessions to control LLM
API cost** — this is not an oversight, it's the normal operating mode; the
board is expected to be dispatched in short, explicitly-authorized batches,
not left running continuously.

**Found 2026-09-10:** the board's `review_dispatch: true` / `request-review`
flow was fully built (review → approve/request-changes → merge) but never
used — every worker task went straight from `running` to `done` via
`kanban_complete`, because nothing in a worker profile's standing
instructions told it to route through review first. Two completed tasks
with real, verified work (PublicDataUSA test coverage, a USPhonebook
reachability re-check) sat unmerged and unreported for ~17-20 hours as a
result, only found by manually noticing a stray `.worktrees/` directory.

**Decision:** `kanban complete` produces no merge-to-main action on its own
(confirmed by inspecting every `hermes kanban` subcommand — none touch git
remotes), and merging a worker's branch should stay a deliberate,
human-verified step regardless — this project's standing bar for any
change (see CONTRIBUTING.md: TDD, real clean-install verification, live
smoke-tests). So the fix is at the review gate, not a new merge
automation: every content-producing worker
profile's persistent description (`hermes profile describe <name> --text
...`, injected as standing context into every task that profile runs) now
instructs it to call `kanban request-review` instead of `kanban complete`.
A human (or the `optoutos-orchestrator` profile, invoked manually) approves
via the review flow; only after that does a human run the actual `git
merge` + full clean-install verification + push — the same verification
this repo's CONTRIBUTING.md already requires for any change. (This gate is
about code-quality/correctness review, not PII exposure — the repo itself
never contains PII; see THREAT_MODEL.md.) See GitHub issue #10 (closed)
for the full investigation.

**Cost-consciousness applies to this board specifically:** before resuming
dispatch on `ready`/`todo` tasks, weigh the batch size and LLM cost
explicitly rather than assuming "more parallel workers" is better — this
was the original reason the board is paused, and that reasoning doesn't
go away just because a review gate now exists.

### 10. No broker is dropped for its shape — deprioritize by effort, never
exclude by scope (2026-09-10)
Every target broker gets *some* handling path, even if today that's
"documented as correctly failing closed" rather than a working adapter.
This was tested directly against BeenVerified (account-gated: no opt-out
form is reachable without logging into a third-party account) — the kanban
board's task chain for it was found hard-blocked pending an unresolved
scope question (see GitHub issue #11, closed).

**Decision:** account-gating, email-only confirmation, manual-only identity
flows, or any other unusual shape are **prioritization signals, not
exclusion criteria.** A broker with high implementation effort or an
awkward mechanism queues behind lower-effort/higher-yield brokers in
ROADMAP.md's priority order — it is never permanently dropped from scope
for being a different shape. The narrower question of *how* to eventually
automate a specific hard case (e.g., does OptOutOS ever accept a
user-supplied already-authenticated session/cookie for BeenVerified,
versus staying manual-only for that one mechanism while the broker itself
stays in scope) is deferred to when that broker's turn actually comes up in
priority order, not decided speculatively now.

### 11. Anti-bot evasion is always allowed; genuine payment-paywall bypass is
opt-in only, off by default (2026-09-10)
Found during CheckPeople work: the free `/results` page it returns carries
no usable match/no-match signal — real data is gated behind a paid-report
checkout flow (see `docs/BROKER_STATUS.md` Round 12). The user's initial
instruction ("bypass/defeat paywalls if they are preventing functionality,
just like we do with anti-bot") was pushed back on, because these are not
the same category of gate:

- **Anti-bot (Turnstile/reCAPTCHA/Cloudflare)** blocks automation
  indiscriminately — a human using a real browser gets through free, same
  as anyone. Defeating it only proves "a human-like browser is here." No
  money changes hands. This remains always allowed, subject to the
  no-CAPTCHA-solving-service policy already documented (see
  THREAT_MODEL.md / METHOD_PRIORITY docstring in `types.ts`).
- **A genuine payment paywall** (CheckPeople's paid report) is the broker's
  actual product/business model. Circumventing it means extracting a paid
  product without paying — a fundamentally different, legally riskier act
  than fighting bot detection, closer to unauthorized-access/payment
  circumvention than to anti-bot evasion.

**Decision (user, verbatim):** "They stole my data and I don't want to pay
them to see it or ask them to remove it. Maybe we allow each user to make
this determination? We default to not bypassing paywalls, but also build
the capability to bypass them. There should be one option to set this
globally." Implemented as:
- `BrokerAdapter.paywallSearch()` — an OPTIONAL adapter method, parallel to
  `search()`, that MAY use a genuine free bypass technique if one is found
  and verified for that specific broker. Most adapters will never
  implement this (see `checkpeople.ts`, which has none — no free technique
  was found there, only a paywall).
- `RunRemovalOptions.allowPaywallBypass` (default `false`) — `runRemoval()`
  only calls `paywallSearch()` as a fallback when `search()` finds no
  confirmed match AND this flag is explicitly true.
- `OPTOUTOS_ALLOW_PAYWALL_BYPASS` environment variable (`1`/`true` to
  enable) — a single global toggle, deliberately not a per-run CLI flag,
  per the user's "one option to set this globally."

This mechanism does not itself defeat any paywall — it only permits an
adapter's bypass code to run if one exists. Adapters must never implement
`paywallSearch()` by simulating a purchase or exploiting an access-control
flaw; only a genuinely free, verified data path qualifies (same
verify-before-shipping discipline as every other adapter in this project).

### 12. Web GUI: local web app first, Tauri wrapper deferred (2026-09-10)

The project's very first stated priority order (2026-09-09, before any
code existed) was **"Privacy, Security, Intuitive UI."** The third leg had
gone unaddressed through 12+ rounds of backend/adapter work — a real,
fair gap flagged directly by the user rather than caught proactively.

**Decision (grilled first, user-confirmed):** build a **local web app**
(`apps/web`, vanilla JS, no frontend framework/build-step yet) rather
than a native desktop app (Electron/Tauri) as the FIRST GUI increment.
Rationale:
- Zero new language/toolchain risk — reuses the exact TS stack already in
  the monorepo. A Tauri shell would mean introducing Rust; Electron would
  mean shipping a full Chromium+Node runtime (150-200MB, larger attack
  surface) for a privacy-focused tool.
- Fits this project's proven incremental-TDD cadence far better than a
  desktop app's inherently lumpier packaging/installer/code-signing work.
- The door stays open: a working local web UI can be wrapped in Tauri
  later with comparatively little rework (Tauri can point at the same
  local server), so nothing here is wasted if a desktop wrapper is wanted
  down the line.

**Backend framework: Hono, not Fastify (corrected 2026-09-10 same day).**
Fastify was picked first WITHOUT doing a real comparison — a process gap
the user caught directly ("Did we do a comparison of fastfy vs others?").
Comparison done retroactively, then acted on:
| | Hono | Fastify |
|---|---|---|
| Schema validation | Pairs naturally with `zod`, which this codebase already uses everywhere (`PersonRecordSchema` etc.) | Own JSON-Schema-based validation, a second validation paradigm alongside the zod already in use |
| TypeScript route typing | Designed TS-first, ergonomic | Generic-parameter style (`app.post<{Body: X}>()`), workable but secondary |
| Runtime portability | Runs on Node/Deno/Bun/Workers — relevant if a future deployment shape changes | Node-only |
| Footprint | Very small | Small |

Switched same-day; all 18 tests (unlock/session + static + household
routes) rewritten against Hono's `app.request()` test API and passed
before/after with identical behavior — a real regression-free swap, not
an assumed one.

**Dependency security discipline applied to the swap:** both `hono` and
`@hono/node-server` have real, recent CVE history (Windows-specific
backslash path traversal in Hono core <4.12.25 — directly relevant since
this project runs on Windows; a repeated-slash middleware bypass and an
auth-bypass-via-inconsistent-URL-decoding bug in `@hono/node-server`
<2.0.5/<1.19.15). Verified current npm versions (`hono@4.13.7`,
`@hono/node-server@2.1.1`) are well past all three fixes before pinning;
`npm audit` confirmed 0 vulnerabilities after install. Same standard
already applied to `@fastify/static` earlier the same session, which also
had real path-traversal CVEs in its own history.

**Unlock policy (user decision, verbatim: "BWS-backed unlock as the
primary path, in-memory prompt as a fallback for users without
Bitwarden"):** implemented as `packages/core/src/web/unlock.ts` —
`resolveUnlockSource()` picks BWS mode only when BOTH `BWS_ACCESS_TOKEN`
and an explicit `OPTOUTOS_BWS_SECRET_ID` are present (a bare token alone
isn't enough to safely default into BWS mode); otherwise falls back to
`InMemoryPassphraseSession`, which holds a passphrase ONLY in process
memory, is never logged (redacted `toString`/`toJSON`), and auto-expires
after 15 minutes idle.

**Security posture:** the server binds to `127.0.0.1` only — never
`0.0.0.0` — matching the CLI's local-first trust model exactly. No
remote-access mode is planned; a user wanting remote access is expected
to use their own VPN/SSH tunnel, same as any other localhost-only admin
tool.

**Scope shipped this session:** unlock/session endpoints
(`GET /api/unlock/status`, `POST /api/unlock`, `POST /api/lock`), full
household CRUD (`GET/POST /api/people`, `GET/PATCH /api/people/:id`)
against a `LocalEncryptedFileStore` (path via
`OPTOUTOS_WEB_STORE_PATH`; BWS store selection for the web GUI itself is
a fast-follow, not yet wired), a read-only per-person broker-status
dashboard (`GET /api/people/:id/dashboard`, issue #14 — one row per
REGISTERED broker, not just ones with run history, so a never-checked
broker is explicit rather than silently absent; no search/removal call
happens from this route), and a minimal vanilla-JS frontend
(`public/index.html` + `app.js` + `app.css`) serving all three screens.
Shared household-mutation logic (`addPerson`/`editPerson`/`listPeople`/
`linkPeople`) was moved from `apps/cli` into `packages/core/src/people/
person-commands.ts`, and the broker registry (`listBrokerIds`/
`getBrokerAdapter`) was similarly moved from `apps/cli/src/registry.ts`
into `packages/core/src/brokers/registry.ts` — same reasoning both
times: apps must not depend on other apps, only on `packages/core`, and
the web GUI needed exactly what the CLI already had. **Not yet built:**
run control with a mandatory search-only default (issue #15). Per user
decision, run control will always expose a search-only
(dry-run) mode as the default, undismissable option — the GUI must never
make submitting a real removal easier to trigger accidentally than the
CLI's explicit `--execute` flag already prevents.

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
