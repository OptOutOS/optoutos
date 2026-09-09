# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, use GitHub's private vulnerability reporting (Security tab → "Report a
vulnerability") on this repository, or email the maintainers at the address listed in
the repository's GitHub profile. We aim to acknowledge reports within 5 business days.

## Scope

In scope:
- `packages/core` — the removal engine, PII-source abstractions, broker adapters
- `apps/cli` — the local-first CLI client
- `apps/cloud/terraform` — the IaC for self-hosted AWS deployments (misconfigurations
  that would weaken the default security posture)

Out of scope:
- Vulnerabilities in third-party data broker websites themselves
- Social engineering against project maintainers

## Design commitments relevant to security review

See [THREAT_MODEL.md](./THREAT_MODEL.md) for the full model. Summary commitments:

- No telemetry, analytics, or phone-home in the reference build.
- PII is never written to logs (redaction at the logging boundary is a required code
  review check on any PR touching `packages/core`).
- PII source is pluggable and defaults to a password-manager integration or local
  runtime input — never checked into config files or committed to git.
- Self-hosted cloud Terraform ships with least-privilege IAM, per-deployment KMS
  encryption, and no shared cross-tenant infrastructure by construction.
- Dependencies are pinned; supply-chain review is part of the CI pipeline (planned:
  `npm audit` / OSV-Scanner gate on PRs touching `package-lock.json`).

## Disclosure policy

We will credit reporters (unless they prefer anonymity) in release notes once a fix
ships. We ask for a reasonable disclosure window (90 days is our default ask) before
any public write-up, given this project's volunteer maintenance model.
