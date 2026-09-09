# PII Storage — Multi-Person Household Store

Design and rationale for the persistent, encrypted, multi-person PII store
(`packages/core/src/people/`). Complements (does not replace) the
single-profile `PiiSource` in `pii-sources/` — this store holds a household
of people plus relationships between them, backing the search-minimization
flow described below.

## Core requirement

Search a broker using ONLY first/last name (the absolute minimum a name-search
UI requires), get back candidate records, and compare those candidates
LOCALLY against the full stored profile for that person — never sending more
PII to the broker than the search step required. This was already true for a
single profile (`runRemoval()`'s existing gate); this store extends it to
multiple people and lets relationship data act as an extra local corroborating
signal.

## Isolation model — physical, not logical

Each unrelated top-level household/owner gets its OWN store instance (own
encrypted file, or own BWS secret) rather than one shared database with
row-level access control. A deployment serving several unrelated people
constructs multiple `PeopleStore` instances pointed at different backing
files/secrets. There is no shared storage layer where an access-control bug
could leak one household's PII into another's — isolation is structural.

## Storage backends (both, user's choice)

- **`LocalEncryptedFileStore`** — fully offline. AES-256-GCM authenticated
  encryption; key derived from a user passphrase via scrypt (memory-hard KDF)
  with a random salt stored (not secret) alongside the ciphertext. No
  recovery mechanism if the passphrase is lost — a recoverable passphrase is
  a weaker passphrase. User owns backup/rotation of both the file and the
  passphrase.
- **`BitwardenSecretsPeopleStore`** — same `bws` CLI convention as the
  existing `BitwardenSecretsPiiSource`. Bitwarden handles encryption at rest
  and backup; household JSON never touches this machine's disk.

Both implement the same `PeopleStore` interface (`load()`/`save()`), so
callers (CLI, future UI) are backend-agnostic.

## Schema

- `PersonRecord`: id (UUID), firstName, lastName, middleName, dateOfBirth,
  emails[], phones[], addresses[], notes (local-only, never sent to a
  broker).
- `RelationshipEdge`: typed edge `{personA, personB, type}` where type is one
  of `spouse | parent | child | sibling | other`. No free-text fallback by
  design — a relative you don't want a full `PersonRecord` for shouldn't be
  represented in this graph at all (add a minimal record with just a name if
  you want them tracked as an entity, or omit entirely).
- `Household`: `{people[], relationships[]}`, with referential-integrity
  validation (every edge must reference people actually present in the same
  household; no duplicate person ids).

## Relationship-aware match scoring

`scoreCandidateWithHousehold(candidate, person, household)` wraps the
existing `scoreCandidate()` and adds a boost (weight 0.15) when a broker's
own `observedRelatives` list contains a name that is ACTUALLY linked to the
target person in the relationship graph — not merely present anywhere in the
household. A name elsewhere in the household with no tracked edge to this
person must not count as corroborating evidence (verified in
household-matching.test.ts).

### Bug found and fixed while building this (2026-09-09)

The base `scoreCandidate()` in `brokers/matching.ts` had an asymmetric bug:
merely having ANY `observedRelatives` on the broker's candidate added
unmatched weight to the scoring denominator whenever the profile's own
`relatives` array was empty — actively LOWERING the score, even though the
broker showing a relative we simply don't have on file is not evidence
AGAINST a match. Fixed so the relatives check is skipped entirely (neutral,
not penalized) when the profile has no relatives on file to compare against.
Regression test added (`matching.test.ts`).

## What's NOT built yet

- CLI subcommands (`optoutos person add/edit/list/link`) to actually
  populate the store day to day — the storage layer, schema, and scoring are
  built and tested; the CLI UX is the next piece.
- Any migration path for `formatVersion` bumps beyond `1`.
- No integration yet between the household store and `runRemoval()`/the CLI
  `run` command — currently `apps/cli run` still takes a single
  `PiiProfile` JSON file per invocation, not a household + person selector.
