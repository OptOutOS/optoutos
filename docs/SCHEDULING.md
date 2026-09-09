# Scheduling recurring re-checks

Data brokers re-populate listings over time as they refresh from public-
record sources — an opt-out is not permanent. `optoutos schedule-run` re-
checks every (person, broker) pair whose re-check interval has elapsed,
and skips everything that was already checked recently.

## Recommended cadence

The default re-check interval is **100 days (~3.3 months)**, per
[privacyguides.org's data-broker-removal guidance](https://www.privacyguides.org/en/data-broker-removals/)
(checked 2026-09-09): they recommend re-reviewing brokers roughly every 3-4
months on an ongoing rotation. This is a cited third-party recommendation,
not an invented number — see `packages/core/src/scheduling/scheduler.ts`
for the exact constant and its source comment.

Per-broker overrides are supported (`BROKER_RECHECK_OVERRIDES_DAYS` in
`scheduler.ts`) for any broker where real observed re-listing behavior
justifies a different cadence — none are set today, since this project has
no such observation yet. If you notice a specific broker re-listing faster
or slower than 100 days, that's a good thing to record there with a
citation (an observed date + evidence), not a guess.

`schedule-run` is designed to be invoked **more often than the interval**
(e.g. daily) — it's a no-op for anything not yet due, so there's no harm in
running it frequently; it only ever acts on what's actually due.

## How "due" is tracked

Each `PersonRecord` in the encrypted household store carries a compact
`brokerRunHistory` rollup: `{ [brokerId]: { lastRunAt, lastStatus } }`. This
is the scheduler's only source of truth for "is this due" — see
`isDue()` in `scheduler.ts`. It intentionally does NOT read the full run
log (below) for this decision; the rollup is small, always up to date, and
travels with the person record (deleted when they're deleted).

A broker is due again after a **successful removal** too, once the interval
elapses — opting out doesn't mean "never check again", since brokers
re-list. `schedule-run` treats every status (`submitted`, `no_match_found`,
`requires_manual_verification`, `failed`) the same way for scheduling
purposes: due once the interval has passed since the last run, regardless
of what that run found.

## The audit log

Every `schedule-run` invocation also appends to a separate, append-only
**JSONL** file — the debugging/audit trail you can `tail -f` or grep,
distinct from the compact rollup above:

- Local-file stores: `<store-path>.runs.jsonl` (e.g.
  `household.enc.json.runs.jsonl`, next to the encrypted household file).
- BWS-backed stores: `~/.optoutos/<secretId>.runs.jsonl` (there's no local
  file to anchor it to, so it lives in a fixed per-secret path instead —
  still one log file per household, never a shared log across households).

**This log is deliberately non-PII** — see `logging/run-logger.ts`. It
contains only `personId` (an opaque UUID, not a name), `broker`, `status`,
`timestamp`, and the adapter's own non-PII `evidence` (candidate counts,
match scores, HTTP status, etc.) — never names, emails, phones, or
addresses. The logger also defensively strips a fixed list of PII-shaped
key names from `evidence` before writing, as a safety net against an
adapter bug leaking something it shouldn't — not the primary enforcement
(adapters are contractually required to keep `RemovalResult.evidence`
non-PII already; see `brokers/types.ts`).

It's plain JSONL, not encrypted — that's intentional, since it contains no
PII and you may want to grep/tail it without decrypting your household
store. If you want it excluded from backups/sync for any reason, treat it
like any other application log.

## Setting up a recurring job

`schedule-run` is a normal one-shot CLI invocation — this project does not
run its own daemon or scheduler. Wire it up with your OS's own scheduler.

### Linux/macOS (cron)

```cron
# Every day at 3am, dry-run only (review the log before ever adding --execute)
0 3 * * * OPTOUTOS_PASSPHRASE="$(cat /path/to/passphrase-file)" \
  /usr/bin/node /path/to/optoutos/apps/cli/dist/cli.js schedule-run \
  --store /path/to/household.enc.json >> /path/to/schedule-run.log 2>&1
```

Never put the passphrase directly in the crontab line — it would be
readable via `crontab -l` and process listings. Read it from a
permission-restricted file (`chmod 600`) or your OS keychain instead.

### Windows (Task Scheduler)

Create a Basic Task, daily trigger, action = "Start a program":
- Program: `node.exe` (or its full path)
- Arguments: `C:\path\to\optoutos\apps\cli\dist\cli.js schedule-run --store C:\path\to\household.enc.json`
- Set the `OPTOUTOS_PASSPHRASE` environment variable on the **user account**
  running the task (System Properties → Environment Variables), not in the
  task's own Arguments field, for the same reason as above (visible in
  `Get-Process`/Task Scheduler history otherwise).

### BWS-backed stores

Same idea, but use `--store-bws <secretId>` instead of `--store <path>`,
and ensure `BWS_ACCESS_TOKEN` is set the same way (environment variable on
the scheduled task's account, never inline in the command).

## `--execute` is still required for real submissions

`schedule-run` respects the exact same dry-run gate as `run`: without
`--execute`, it only searches and updates the rollup/log — it never submits
a removal request, even on a confirmed match. Verify a dry-run's output
looks sane (check the log, not just the summary line) before adding
`--execute` to a recurring job you won't be watching closely.

## Restricting to specific brokers

By default `schedule-run` checks every registered broker for every person
in the store. Pass `--broker <id>` (repeatable) to restrict it — useful
while a broker is known-broken (e.g. currently blocked, see
`docs/BROKER_STATUS.md`) and you don't want it cluttering the log with
guaranteed no-ops every run:

```bash
optoutos schedule-run --store ./household.enc.json \
  --broker advancedbackgroundchecks --broker spokeo --broker usphonebook
```
