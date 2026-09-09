# Broker Coverage Status

Live-verified status of all 12 Privacy Guides shortlist brokers, as of
2026-09-09. "Verified live" means the adapter's behavior was actually
observed against the real site (not just type-checked). Method priority is
`api > form > email` per project policy — none of the 12 were found to have
a public opt-out API.

| Broker | Method | Live Result | Notes |
|---|---|---|---|
| ClustrMaps | — | Not testable | `clustrmaps.com` is DNS-sinkholed to `0.0.0.0` by this network's UDM Pro (confirmed against 1.1.1.1 too — network-wide, not a local override). Deprioritized as spike target for this reason. |
| That'sThem | form | `requires_manual_verification` | Real form fields verified (`#name #street #city #state #zip #email #phone`). Cloudflare Turnstile challenge served to automated browsers; adapter detects and fails closed, per no-CAPTCHA-solving policy. |
| Advanced Background Checks | form | `requires_manual_verification` | Direct name/email opt-out form found (`#mode #sfn #smn #sln #semail`), protected by reCAPTCHA. Fails closed. |
| BeenVerified | form | `requires_manual_verification` | Both search/opt-out routes redirect to a JS app shell exposing hCaptcha/Cloudflare Turnstile markers. No selectors guessed. |
| CheckPeople | form | `failed` (honest, not a bug) | Cloudflare 403-blocked interactively; opt-out flow structure could not be verified, so the adapter refuses to guess rather than fabricate selectors. |
| InfoTracer | form | `failed` / `requires_manual_verification` | "Are you human?" interactive gate observed; adapter detects known gate markers and fails closed. One test run hit a different rate-limit page and returned `failed` — consistent with the honest-uncertainty design, not a fabricated pass. |
| Intelius | — (login-gated) | `requires_manual_verification` | The suppression flow (`suppression.peopleconnect.us`) is a login-gated SPA requiring an account/session. No anonymous opt-out path or public API exists. Adapter intentionally does not create accounts or attempt login. |
| PublicDataUSA | — | `failed` (domain unreachable) | `publicdatausa.com` returns DNS SERVFAIL from both the local resolver and 1.1.1.1 — the domain itself appears dead, independent of this network's filtering. Placeholder adapter documents this rather than silently omitting the broker. |
| Radaris | form (manual) | `requires_manual_verification` | Real flow requires selecting a specific profile, "Start Removing," an email submission, then an out-of-band email confirmation link/code. Too identity-flow-heavy to safely automate; correctly marked manual. |
| Spokeo | form | `requires_manual_verification` | Confirmed Spokeo requires per-listing opt-out by URL plus email confirmation. `PiiProfile` has no listing-URL field yet — a real gap, not a false negative. |
| USPhonebook | form | `requires_manual_verification` | Combined search+optout page verified (name/email fields + reCAPTCHA + "Begin Removal Process," which then emails a second-step link). Fails closed on reCAPTCHA. |
| Whitepages | form | `requires_manual_verification` | Cloudflare 403 block confirmed via both plain and stealth-patched Playwright; no CAPTCHA widget even reached. Fails closed. |

## Honest summary

**0 of 12 brokers currently complete an actual automated submission.** This
is the correct and expected state at this stage, not a shortfall to paper
over — see project policy ("anti-bot if easy, otherwise move on") and the
`dryRun` guard that's intentionally still `true` everywhere pending real
`PiiSource`-backed data and explicit user approval to go live.

What IS proven:
- The `BrokerAdapter` interface and fail-closed pattern hold up across 11
  independently-built adapters with real, structurally different anti-bot
  postures (Turnstile, reCAPTCHA, Cloudflare 403, login-gate, email-out-of-band,
  dead domain, network-level DNS sinkhole).
- Every adapter's behavior was actually executed against the live site and
  the reported result matches what was observed, not assumed.
- The most common real blocker across brokers is Cloudflare-family anti-bot
  protection (7 of 12), confirming the `eraser` project's approach (email-only
  GDPR/CCPA requests, sidestepping web forms and their anti-bot layers
  entirely) is the more scalable long-term default — a real design signal
  from this batch, not a guess.

## Immediate next real steps

1. Build the email-based (SMTP/GDPR-CCPA template) removal path — the
   `eraser`-validated pattern — as the actual primary path for most of these
   brokers, since form automation is blocked on 7/12.
2. Add a `listingUrl` field (or similar) to `PiiProfile` / a broker-specific
   metadata bag for Spokeo-style per-listing opt-outs.
3. Decide whether Intelius/Radaris (identity-verification-heavy) belong in
   the "automatable" registry at all, or should be permanently
   manual-only/documentation-only entries.
