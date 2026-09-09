# Requirements

Functional and non-functional requirements for OptOutOS. Written retroactively
(2026-09-09) to capture decisions that were made correctly in practice across
early sessions but never written down in one place — see git history for the
actual decision trail if you need "why" on something not covered here.

## Functional requirements

### Must have (core promise)
- **FR1.** Search a data broker using only a person's first and last name (the
  minimum a broker's own search UI requires) — never submit more PII than
  that for the search step.
- **FR2.** Compare every candidate the broker's search publicly returns
  against the user's full locally-stored profile, entirely on-device. The
  full profile must never be sent to the broker for this comparison.
- **FR3.** Only submit an opt-out/removal request for a candidate that clears
  a confidence threshold (currently 0.6) — never blind, never on a login-gated
  broker with no searchable results to confirm against.
- **FR4.** Support multiple people (a household) with typed relationships
  between them (spouse/parent/child/sibling/other), and use confirmed
  relationships as a match-confidence signal.
- **FR5.** Persist PII across runs, encrypted at rest, with the user's choice
  of storage backend (local file or Bitwarden Secrets Manager).
- **FR6.** Provide a dry-run mode that performs the search step (read-only)
  and reports what *would* be matched/submitted, without ever submitting.
- **FR7.** Never attempt to bypass an active CAPTCHA/Turnstile/reCAPTCHA
  challenge — detect it and fail closed to a status requiring manual
  human verification.
- **FR8.** Support at least three removal methods, in priority order:
  API (if a broker has one) > web form > email (GDPR/CCPA-style request).

### Should have (not yet built)
- **FR9.** Email-based removal path (SMTP/GDPR-CCPA template), for brokers
  whose web form is anti-bot-blocked but who honor formal email requests.
- **FR10.** Scheduled/recurring re-runs — brokers re-list people from fresh
  source data periodically; a one-time run is not sufficient for real
  protection.
- **FR11.** A packaged distribution (npm publish and/or binary/Docker image)
  so a non-technical user doesn't need to clone+build TypeScript themselves.

### Could have (explicitly deferred)
- **FR12.** Desktop GUI (`apps/desktop`, planned in README, not started).
- **FR13.** Self-hosted cloud/Terraform deployment (`apps/cloud`, scaffolded
  but de-scoped after the local-first pivot — see DESIGN.md).

## Non-functional requirements

- **NFR1 (Privacy).** No telemetry, no phone-home, no analytics in the
  reference build. Any future optional network call (e.g. broker-registry
  update checks) must be opt-in and disclosed.
- **NFR2 (Security).** PII at rest must be encrypted (AES-256-GCM or
  equivalent authenticated encryption), never plaintext on disk by default.
- **NFR3 (Security).** Secrets/passphrases are never accepted as CLI
  arguments (shell history / process-list exposure) — environment variables
  only.
- **NFR4 (Auditability).** Match-scoring logic must be simple/explainable
  (field-weighted, not ML), so a privacy-critical gate can be verified by
  code inspection, not just tested behaviorally.
- **NFR5 (Quality).** TDD for all new work (red-green-refactor); every
  adapter/engine change ships with regression tests, not just manual
  verification.
- **NFR6 (CI/Supply chain).** Automated dependency updates (Dependabot),
  secret scanning, CodeQL, and branch protection requiring passing CI —
  all using free GitHub features, no paid tooling required.
- **NFR7 (License).** AGPL-3.0, chosen specifically to prevent closed-source
  SaaS resale without contributing improvements back.
- **NFR8 (Isolation).** In any multi-person/multi-tenant deployment, isolation
  between unrelated households must be structural (separate store instances),
  not merely application-level access control.

## Explicit non-goals

(See THREAT_MODEL.md "Explicit non-goals" for the full list and rationale.)
Summarized: not an anonymity tool, cannot guarantee permanent removal
(brokers re-acquire data), does not defend against a broker's own misuse of
submitted PII, does not pursue legal remedies.
