# Spike Findings — 2026-09-09

## Goal
Prove the removal pipeline end-to-end against one real broker before scaling
to the full 12-broker shortlist.

## What was actually verified (live, not simulated)

1. **`packages/core` builds and type-checks cleanly** (`tsc -p tsconfig.json`,
   zero errors) with a `PiiProfile` schema, pluggable `PiiSource` interface
   (local file + Bitwarden Secrets Manager), and a `BrokerAdapter` interface.

2. **DNS-level blocking discovered and diagnosed, not assumed.** ClustrMaps
   (`clustrmaps.com`) resolves to `0.0.0.0` even when queried directly against
   1.1.1.1 — the UDM Pro is intercepting port-53 DNS network-wide and
   sinkholing it as a known tracker/broker domain. Confirmed via `nslookup`
   against both the local resolver and an external one. Switched spike target
   to That'sThem, which resolves normally.

3. **That'sThem (`thatsthem.com/optout`) form fields verified via live DOM
   inspection** (not guessed): `#name`, `#street`, `#city`, `#state` (select,
   full state names not abbreviations), `#zip`, `#email`, `#phone`, submit
   button "Submit Opt-Out Request". No search/lookup step required.

4. **Plain headless Playwright is hard-blocked (403 CloudFront)** before ever
   reaching the form. Confirmed via direct page inspection — response was a
   CloudFront 403 error page, not the opt-out form.

5. **`playwright-extra` + stealth plugin gets past the outright 403**, but the
   site then serves a **Cloudflare Turnstile interactive challenge**
   ("Confirm you're human") — confirmed via captured `cf-turnstile` widget
   markup in the page HTML, not inferred from appearance alone.

6. **Per project policy — no CAPTCHA-solving** — the adapter (`thatsthem.ts`)
   detects the Turnstile widget and fails closed with status
   `requires_manual_verification`, rather than attempting to bypass it. This
   was tested live and confirmed working correctly:
   `node spike-test-stealth.mjs` → `{"status": "requires_manual_verification", ...}`.

## Design decision this produced: method priority

Per user decision, broker adapters should prefer, in order:
1. **API** — if the broker has one, no anti-bot fight at all.
2. **Web form** — automate directly if reachable without a CAPTCHA/Turnstile
   fight. If an active challenge is hit, fail closed (see above), don't
   invest in solving it.
3. **Email** — formal GDPR/CCPA-style deletion request via SMTP. Works even
   against Turnstile-protected sites since no page load is needed. This is
   the pattern the existing FOSS tool `eraser` (digisamroc/eraser) uses
   exclusively — it never fights anti-bot at all, only sends emails.

This is now encoded as `METHOD_PRIORITY` in `packages/core/src/brokers/types.ts`.

## Known gaps / honest todos

- `ThatsThemAdapter.optOut()` has never actually submitted a real opt-out
  request — `dryRun = true` is hardcoded. It fills the form (when reachable
  without a challenge) but does not click submit. This must stay true until
  a real user profile is wired through a `PiiSource`, reviewed, and the user
  explicitly approves a live submission.
- No CI, no `apps/cli` yet, no email-based (SMTP/SES) adapter implemented yet
  despite email now being the recommended first-tier method for most
  brokers — the spike proved the form-automation path works/fails correctly,
  not that email is wired up.
- Turnstile appeared inconsistently between a real desktop-browser session
  (no challenge) and headless/stealth Playwright (challenge every time) —
  fingerprint-based, not a universal gate. Re-verify periodically; don't
  assume today's result is permanent in either direction.
- `playwright-extra` pulls in some deprecated transitive dependencies
  (`inflight`, `rimraf@3`, `glob@7`) — fine for a spike, should be
  reconsidered (or pinned/audited) before this is a permanent dependency.
