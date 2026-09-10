# OptOutOS

**A FOSS, local-first engine for removing your personal data from online data brokers.**

Data brokers and "people search" sites republish your name, address, phone number,
relatives, and more — usually sourced from a small handful of aggregators. OptOutOS
automates opting you out of those aggregators, prioritizing **privacy, security, and an
intuitive experience** over convenience shortcuts that require trusting a third party
with your PII.

## Why another one of these?

Most existing tools in this space are either:
- Commercial SaaS (Optery, Incogni, DeleteMe, EasyOptOuts) — closed-source, you must
  trust their servers with your PII.
- Abandoned/thin FOSS scripts — broker lists rot fast; no shared core architecture.

The [Privacy Guides community has explicitly stated](https://discuss.privacyguides.net/t/what-s-the-best-data-removal-service/19652)
that the correct architecture is **local-first**: an app that runs on your own device
and programmatically fills opt-out forms, so your PII never leaves your machine unless
you explicitly choose a self-hosted cloud deployment. OptOutOS is built around that
principle from day one.

## Architecture

```
packages/core     — broker registry, removal engine, PII-source abstraction,
                     Playwright adapters, evidence logging (shared by every surface)
apps/cli          — local-first CLI client (built, working)
apps/web          — local-only web GUI (Hono; built, working)
apps/desktop      — (planned) native wrapper, deferred in favor of the web GUI
apps/cloud        — (scaffolded, de-scoped) Terraform + Lambda container for
                     self-hosted scheduled runs — see docs/DESIGN.md "Local-first pivot"
```

Two deployment modes, one engine:
- **Local-first (default):** PII never leaves your machine. You run the CLI (or later,
  the desktop app) yourself, on your own schedule.
- **Self-hosted cloud (opt-in):** deploy your own isolated AWS stack via Terraform for
  unattended scheduled runs. PII is envelope-encrypted per-deployment (your own KMS
  key); no shared infrastructure between deployments, ever.

## Broker priority list

Starting with the ~12 aggregator-tier brokers identified by Privacy Guides as covering
most smaller people-search sites by resale:

Advanced Background Checks, BeenVerified, CheckPeople, ClustrMaps, InfoTracer,
Intelius, PublicDataUSA, Radaris, Spokeo, That's Them, USPhonebook, Whitepages.

See `packages/core/src/brokers/` for the per-broker config/adapter status.

## Design principles (non-negotiable)

1. **No telemetry, no phone-home, no analytics** in the reference build. Any optional
   network calls (e.g. broker-registry update checks) are opt-in and disclosed.
2. **PII is never logged.** Loggers redact known PII fields at the boundary.
3. **PII source is pluggable**, never hardcoded: local file, environment, a password
   manager (e.g. Bitwarden Secrets Manager), or cloud KMS-encrypted storage.
4. Designed to meet [Privacy Guides' data-removal-service criteria](https://www.privacyguides.org/en/data-broker-removals/#criteria):
   not white-labeled, no data-broker industry affiliation, PII used only for opt-out.
5. **Anti-bot bypass is in scope using real-browser, locally-run solvers only**
   (revised 2026-09-09 — see THREAT_MODEL.md "Anti-bot / CAPTCHA policy"); no
   third-party paid CAPTCHA-solving API is ever used. Email is the last-resort
   removal method, not the primary anti-bot workaround.

## Status

🚧 Working spike / pre-alpha with a hardened core — not yet an MVP. 3/12
brokers have real, live-verified search; a local web GUI (unlock,
household management, broker-status dashboard) is built; zero real
removal submissions have completed end to end yet. See
[docs/ROADMAP.md](docs/ROADMAP.md) for the honest current state and
priorities, and the [wiki's Project Status & MVP page](https://github.com/OptOutOS/optoutos/wiki/Project-Status-and-MVP)
for a human-readable summary.

## Contributing

See [AGENTS.md](AGENTS.md) for the development guide (architecture,
layering rules, verification discipline, what's in/out of scope) —
written for AI coding assistants and human contributors alike.

## License

AGPL-3.0 — see [LICENSE](./LICENSE). Chosen specifically to prevent closed-source SaaS
resale of this project without contributing improvements back.
