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

## Anti-bot / CAPTCHA policy (revised 2026-09-09)

**Prior policy (2026-09-09, superseded same day):** never attempt to solve
or bypass an active CAPTCHA/Turnstile/reCAPTCHA challenge under any
circumstances; always fail closed to `requires_manual_verification`.

**Current policy:** bypass anti-bot challenges (including interactive
CAPTCHA/Turnstile/reCAPTCHA) **when a real, working solver is available**,
using a real-browser-based solver (not a third-party paid CAPTCHA-farm API —
that would reintroduce exactly the "trust a third party with your identity/
traffic" problem this project exists to avoid). **Email-based removal is now
the last resort**, used only when no broker-specific technical path (API,
form with or without anti-bot solving) is viable at all.

Rationale for the reversal: the project's own live broker survey found 7 of
12 target brokers blocked specifically by Cloudflare/Turnstile-family
anti-bot on their web forms — the single largest category of blocker by far.
A hard no-bypass line meant most of the target broker list was permanently
capped at `requires_manual_verification` regardless of how much adapter
engineering went into search/scoring. The user made the explicit
determination that automating a broker's own publicly-offered opt-out
mechanism — including clearing whatever anti-bot gate stands in front of
it — is within scope for a tool whose sole purpose is exercising a data
subject's own opt-out right, as distinct from bulk/malicious scraping.

- **Still a hard line, unchanged:** no third-party paid CAPTCHA-solving
  service (2Captcha, CapSolver, Scrappey, etc.) — those require sending the
  challenge (and often site/traffic metadata) to an external company, which
  is a real trust boundary this project does not cross. Only real-browser,
  locally-run solvers (e.g. a self-hosted [EzSolver](https://github.com/ismoiloffS/EzSolver)-
  or [Theyka/Turnstile-Solver](https://github.com/Theyka/Turnstile-Solver)-style
  service, following the same self-hosted-HTTP-service pattern already used
  for FlareSolverr) are in scope. If no reliable solver exists for a given
  challenge type at all (e.g. an anti-bot vendor this project has no working
  solver for), the adapter must fail closed to `requires_manual_verification`
  — never guess, never fabricate a submission, never retry indefinitely
  against a challenge it cannot actually clear.

## reCAPTCHA v2 (self-hosted, puzzle-solving) is in scope; v3 is undecided
(2026-09-10)

Found while re-surveying ABC and USPhonebook (both blocked on real
reCAPTCHA, no solver existed): reCAPTCHA solving is a MEANINGFULLY
DIFFERENT category of "solve" than Turnstile, and the distinction was
surfaced to the user explicitly before building anything, rather than
assumed to be equivalent.

- **Turnstile (existing solver, thatsthem.ts):** the solver drives a real
  browser; Cloudflare's own widget decides "this looks like a genuine
  human session" and passes it. Closer to "behave authentically" than
  "defeat a puzzle."
- **reCAPTCHA v2 (checkbox/image/audio challenges):** free/self-hosted
  options (e.g. YOLO-based vision-model image solvers, Buster-style audio
  solvers) actually DEFEAT the underlying challenge puzzle — a materially
  more aggressive technique, closer to what CAPTCHAs specifically exist to
  stop.
- **reCAPTCHA v3 (invisible, behavioral trust score):** free approaches
  rely on a real, aged, logged-in Google account accumulating trust over
  time — a persistent Google identity tied to this project's automation,
  a different infrastructure commitment than anything else OptOutOS does.

**Decision (user, verbatim):** "Yes — image/audio puzzle-solving (vision
models / Buster-style) is fine, same spirit as Turnstile: get past the
gate to submit our own real opt-out request, nothing malicious." **v2
image/audio puzzle-solving is in scope.** v3's persistent-Google-account
requirement was NOT explicitly cleared — treat as undecided/out of scope
until a separate explicit decision is made, should a v3-gated broker come
up. Paid third-party solving services remain hard-forbidden regardless of
CAPTCHA version — this decision only concerns free, self-hosted,
real-browser-driven solving.

## Payment paywalls are NOT anti-bot, and are not bypassed by default
(2026-09-10)

Anti-bot challenges (above) block automation indiscriminately — a human in
a real browser gets through free, same as anyone, so defeating one only
proves "a human-like browser is here." A genuine PAYMENT paywall (e.g.
CheckPeople gating its report behind checkout — see `docs/BROKER_STATUS.md`
Round 12) is different in kind: it gates the broker's own paid product, and
circumventing it means extracting that product without paying, which is
closer to unauthorized-access/payment-circumvention than to bot-detection
evasion, with real legal exposure of its own.

**Policy:** OptOutOS never attempts to bypass a genuine payment paywall by
default. A user may opt in globally via `OPTOUTOS_ALLOW_PAYWALL_BYPASS=1`,
which permits (but does not itself implement) an adapter's optional
`paywallSearch()` fallback — see `docs/DESIGN.md` decision 11 for the full
mechanism. Adapters must never implement `paywallSearch()` by simulating a
purchase or exploiting an access-control flaw; only a genuinely free,
independently verified data path qualifies.

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
