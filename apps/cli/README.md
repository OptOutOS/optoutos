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

## Exit codes

- `0` — command completed (including a clean "no match found" result).
- `1` — invalid arguments, unreadable/invalid profile, unknown broker, or
  the removal itself failed (`status: "failed"`).
