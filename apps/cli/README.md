# @optoutos/cli

Local-first command-line runner for OptOutOS. This is the first real,
runnable entry point into the project — everything runs on your own machine,
your PII never leaves it except to the specific broker you target.

## Install / build

From the repo root:

```
npm install
npm run build --workspace=@optoutos/core
npm run build --workspace=@optoutos/cli
```

## Usage

```
node apps/cli/dist/cli.js list-brokers

node apps/cli/dist/cli.js run \
  --broker <brokerId> \
  --profile ./my-profile.json
```

`run` is **dry-run by default**: it performs the read-only `search()` step
and, if a confident match is found, reports it — but never submits a
removal request. Pass `--execute` to actually attempt removal:

```
node apps/cli/dist/cli.js run --broker advancedbackgroundchecks --profile ./my-profile.json --execute
```

Even with `--execute`, an adapter will still refuse (status
`requires_manual_verification`) if it detects an active CAPTCHA/Turnstile
challenge on the removal step — this project never attempts to bypass those.
See `THREAT_MODEL.md` and `docs/BROKER_STATUS.md`.

## Household store (multi-person, persistent, encrypted)

Instead of a one-off `--profile` JSON file, you can manage a persistent,
encrypted, multi-person household — including relationships between people
(spouse/parent/child/sibling/other) — and run removals against anyone in it.
See `docs/PEOPLE_STORE.md` for the full design.

```
# Add people
node apps/cli/dist/cli.js person add --store ./household.enc.json \
  --first John --last Smith --street "123 Main St" --city Seattle --state WA --zip 98101

node apps/cli/dist/cli.js person add --store ./household.enc.json --first Jane --last Smith

# List them (to get ids)
node apps/cli/dist/cli.js person list --store ./household.enc.json

# Link two people (used as a match-confidence signal — see PEOPLE_STORE.md)
node apps/cli/dist/cli.js person link --store ./household.enc.json \
  --a <johnId> --b <janeId> --type spouse

# Edit a person
node apps/cli/dist/cli.js person edit --store ./household.enc.json --id <personId> --email new@example.com

# Run a removal sourced from the household store instead of --profile
node apps/cli/dist/cli.js run --broker advancedbackgroundchecks \
  --person <johnId> --store ./household.enc.json
```

**Passphrase**: the local encrypted store's passphrase is read from the
`OPTOUTOS_PASSPHRASE` environment variable — never accepted as a CLI flag
(would land in shell history and be visible to other processes via
`ps`/Task Manager). There is no recovery mechanism if it's lost — a
recoverable passphrase is a weaker passphrase; back up the file and
passphrase separately and securely.

**Bitwarden-backed alternative**: pass `--store-bws <secretId>` instead of
`--store <path>` to use a Bitwarden Secrets Manager secret as the backing
store (same `BWS_ACCESS_TOKEN` env var convention as the rest of the
project). Bitwarden then handles encryption at rest and backup.

## Profile format

`--profile` points to a local JSON file matching the `PiiProfile` schema in
`packages/core/src/pii.ts` (firstName, lastName, emails, phones, addresses,
relatives). This file is read from disk only — never uploaded, never logged.

## Some brokers require FlareSolverr

A few brokers' search endpoints are behind a Cloudflare challenge that this
project's policy will not bypass directly (see `docs/FLARESOLVERR.md`). For
those, set `FLARESOLVERR_URL` (e.g. `http://localhost:8191`) to a
self-hosted FlareSolverr instance before running the CLI. Brokers whose
search doesn't need it will ignore the env var entirely.

## Some brokers require a Turnstile/CAPTCHA solver (revised 2026-09-09)

Some brokers' opt-out/search pages present an interactive Cloudflare
Turnstile challenge — not the passive JS check FlareSolverr handles. Per the
project's revised anti-bot policy (see `THREAT_MODEL.md`), this is bypassed
using a real-browser, locally-run solver service (e.g. a self-hosted
[EzSolver](https://github.com/ismoiloffS/EzSolver) instance). Set
`TURNSTILE_SOLVER_URL` (e.g. `http://localhost:8191`, on a different port
than FlareSolverr if both are running) to enable this. If unset, or the
solver fails, the adapter falls back to `requires_manual_verification`
exactly as before — never guesses or fabricates a submission. Only
real-browser, locally-run solvers are ever used — never a third-party paid
CAPTCHA-solving API.

## Recurring re-checks (scheduling)

Data brokers re-populate listings over time — a one-time opt-out is not
permanent. `schedule-run` re-checks every (person, broker) pair whose
re-check interval has elapsed, and skips anything checked recently:

```
node apps/cli/dist/cli.js schedule-run --store ./household.enc.json
```

Same dry-run-by-default / `--execute` gate as `run`. Writes a non-PII JSONL
audit log next to the store. See `docs/SCHEDULING.md` for the recommended
cadence (cited from privacyguides.org), how "due" is tracked, and how to
wire this up as a cron/Task Scheduler job.

## Exit codes

- `0` — command completed (including a clean "no match found" result).
- `1` — invalid arguments, unreadable/invalid profile, unknown broker, or
  the removal itself failed (`status: "failed"`).
