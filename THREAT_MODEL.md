# Threat Model

This document defines who OptOutOS defends against, what it assumes, and what it
explicitly does not try to solve. Written before code, per project design principles.

## Assets being protected

- The user's PII (name, addresses, phone numbers, emails, DOB, relatives) as submitted
  to data-broker opt-out forms.
- Evidence of submitted removal requests (timestamps, confirmation IDs/screenshots) —
  sensitive because it correlates identity + broker + PII fields used.
- Any credentials used to source PII (e.g. Bitwarden Secrets Manager tokens) or to
  send email-based opt-outs (SMTP/SES credentials).

## Adversaries considered

| Adversary | Concern | Mitigation |
|---|---|---|
| Curious/malicious local user (shared machine, roommate) | Reads PII/config files at rest on disk | Local-mode PII sourced from a password manager at runtime by default, not persisted to plaintext files; evidence store excludes raw PII, only broker/date/status |
| Cloud provider (AWS) in self-hosted cloud mode | Subpoena, insider access, misconfigured bucket | Per-deployment KMS CMK, envelope encryption of PII fields before persistence, no cross-tenant shared infra, S3 buckets private+encrypted by default in Terraform |
| Compromised/malicious data broker | Broker sells or leaks the PII you're required to submit to opt out | Out of scope for this tool to prevent (inherent to the opt-out process itself — see Privacy Guides' note that removal requires providing PII); mitigate by only submitting the minimum fields a given broker's form requires, never more |
| Network attacker (MITM) | Intercepts PII in transit to broker forms/emails | All broker interactions over HTTPS/TLS only; adapters reject non-TLS endpoints |
| Malicious/compromised npm dependency | Supply-chain exfiltration of PII during automation run | Pin dependencies, minimize dependency surface in `packages/core`, consider running Playwright automation in a sandboxed/ephemeral context, dependency review in CI |
| Project maintainers themselves (supply chain trust) | Malicious code merged into core engine that exfiltrates PII | Public source, reproducible builds goal, code review requirement on `packages/core`, no telemetry by design (nothing to exfiltrate silently) |
| Self-hoster's own misconfiguration | Overly permissive IAM/S3 in their own AWS account | Terraform ships with least-privilege IAM by default; docs include a security review checklist before first deploy |

## Explicit non-goals

- **Anonymity.** This tool does not hide who you are from brokers — by design, it must
  identify you accurately enough for brokers to locate and remove your records. Do not
  confuse this with an anonymity tool.
- **Preventing brokers from re-acquiring your data.** Brokers routinely re-list
  individuals every 30–90 days from new source data. OptOutOS supports re-running on a
  schedule but cannot guarantee permanent removal — no tool can.
- **Protecting against a compromised broker itself.** Once PII is submitted to a
  broker's opt-out form, its handling is outside OptOutOS's control.
- **Legal enforcement.** This tool automates the *submission* of removal requests; it
  does not pursue legal remedies if a broker ignores them.

## Legal / Terms-of-Service risk (accepted, 2026-09-09)

Automating interaction with a broker's website (even solely for the purpose of
submitting a legitimate opt-out/removal request) likely violates that broker's
Terms of Service in the general case — most ToS prohibit automated access
regardless of intent. This project accepts that risk deliberately: the
alternative (manual-only submission) does not scale to 12+ brokers repeated
on a recurring basis, and the *purpose* of every automated interaction here
is exclusively the user's own opt-out, never scraping broker data for reuse.
This is a conscious tradeoff, not an oversight — flagged here so it is
visible to contributors and self-hosters rather than left implicit.

## Trust boundaries by deployment mode

- **Local-first (default):** trust boundary is the user's own machine. No PII crosses
  a boundary to any party controlled by the OptOutOS project.
- **Self-hosted cloud (opt-in):** trust boundary extends to the user's own AWS account
  only. The OptOutOS project never operates shared infrastructure that would see any
  user's PII — there is no "OptOutOS cloud" to breach.

## Open questions (revisit as the project matures)

- Should Playwright automation runs be sandboxed (e.g. gVisor, Firecracker) in cloud
  mode to limit blast radius of a compromised broker-adapter script or dependency?
- Should evidence storage encrypt at the field level (broker name in cleartext, PII
  fields encrypted) to allow audit/search without decrypting PII?
