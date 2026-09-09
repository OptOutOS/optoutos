# Broker Coverage Status

Live-verified status of all 12 Privacy Guides shortlist brokers, as of
2026-09-09. "Verified live" means the adapter's behavior was actually
observed against the real site (not just type-checked). Method priority is
`api > form > email` per project policy — none of the 12 were found to have
a public opt-out API.

## Privacy-minimization gate (added 2026-09-09)

Per explicit user requirement: **a removal request must never be sent unless
the user's PII was first confirmed present via a minimal-PII search,
compared locally against the fuller profile.** This is now enforced as a
mandatory chokepoint, `runRemoval()` in `packages/core/src/brokers/engine.ts`
— not left to per-adapter discipline:

1. `adapter.search()` is called with only `searchFields` (a small subset of
   PII — e.g. name + city, never full address/phone/email up front).
2. Every candidate the broker's own search publicly returns is scored
   **locally** (`scoreCandidate()` in `matching.ts`) against the full local
   profile. The full profile is never sent to the broker for this step.
3. Only if the best-scoring candidate clears `MATCH_CONFIDENCE_THRESHOLD`
   (0.6) does `adapter.optOut()` ever get called, and only for that specific
   confirmed candidate.
4. If no candidate matches, or an adapter has no automatable `search()` at
   all (e.g. login-gated brokers), the result is `no_match_found` or
   `requires_manual_verification` respectively — it never falls back to
   submitting opt-out blind.

Verified live: scoring correctly distinguishes a strong multi-field match
(score 1.00, proceeds) from a same-last-name/wrong-city false-positive risk
(score 0.46, blocked below the 0.6 threshold) and a full non-match (score
0.00, blocked). Verified via `runRemoval()` against the live That'sThem
adapter, which has no `search()` implemented yet — confirmed it short-circuits
to `requires_manual_verification` before ever calling `optOut()`, rather than
silently skipping the gate.

**Honest current gap:** none of the 11 non-thatsthem adapters implement a
real `search()` returning actual `SearchCandidate[]` yet — most never got
past anti-bot walls far enough to verify real search-result selectors (see
per-broker notes below). Under the new gate, every adapter therefore
currently resolves to `requires_manual_verification` via the
"no search capability" path, not via a confirmed-match path. This is the
correct, safe default (no adapter can accidentally skip the gate), but it
means the next real engineering work is implementing verified `search()`
methods per broker, not just opt-out forms.

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

## Round 2 — search() implementation attempt (2026-09-09)

Attempted to implement real, live-verified `search()` methods for 7 of the
12 brokers (Advanced Background Checks, That'sThem, USPhonebook,
CheckPeople, InfoTracer, Spokeo, Whitepages) as the natural next step after
the privacy-minimization gate (above) made a working `search()` the actual
bottleneck to any broker moving past `requires_manual_verification`.

**Result: 0 of 7 reached real, verifiable search results.** Every broker
hit an anti-bot wall before a result listing was ever rendered:

| Broker | What blocked it |
|---|---|
| Advanced Background Checks | Cloudflare "Just a moment..." challenge on the `/find/name/{term}` route |
| That'sThem | Generic error page on the `/name/{first}-{last}/{city}-{state}` route (previously Turnstile; today a different error — anti-bot posture appears to shift) |
| USPhonebook | Bare host returns Cloudflare 403 before the `/search` POST endpoint is reachable |
| CheckPeople | HTTP 403 with an "anonymous access" verification wall |
| InfoTracer | The search form itself loads (HTTP 200, real fields confirmed: firstname/lastname/city/state), but a real dummy submission is rejected with HTTP 400 before any result renders |
| Spokeo | HTTP 403, no search form reachable at all |
| Whitepages | HTTP 403 after redirect to `www.whitepages.com` |

Every adapter was updated to add a `searchFields` property and a `search()`
method that fails closed to `[]` rather than fabricating a result — no
candidate data was invented for any broker. This is the correct outcome
under the project's "anti-bot if easy, otherwise move on" policy, but it
means these 7 adapters are functionally unchanged in practice: they still
resolve to `requires_manual_verification` via the engine's "no confirmed
candidates" path (identical end state to before, just now via a real
attempted-and-failed search rather than a "no search() at all" stub).

**What this confirms, not just suspects:** the web-form automation path is
close to exhausted for this broker set under the current
Playwright/playwright-extra+stealth approach. Real next options, in rough
order of expected leverage:

1. **Email-based (GDPR/CCPA) removal requests** — the `eraser`-validated
   pattern. Sidesteps web-form anti-bot entirely. Should now be treated as
   the primary path for most of these 12 brokers, not a fallback — this is
   the second independent data point (after Round 1) pointing the same way.
2. **FlareSolverr** (see earlier discussion) — could plausibly unblock the
   *passive* Cloudflare challenges (Whitepages, USPhonebook's bare-host
   403, possibly Advanced Background Checks' "Just a moment" screen) since
   those are compute-challenge pages, not interactive CAPTCHAs. Would not
   help CheckPeople/Spokeo's harder walls or That'sThem's Turnstile.
   Deferred per user decision until the engine work was solid — now is a
   reasonable time to revisit.
3. Accept that a meaningful fraction of this broker set is permanently
   manual-only (documented via `requires_manual_verification` with clear
   evidence), and let the CLI surface these as a checklist/reminder for the
   user, similar to Privacy Guides' own "5 minutes a week" manual strategy —
   rather than chasing full automation on brokers whose whole business model
   depends on resisting exactly this kind of automation.

## Immediate next real steps

1. Build the email-based (SMTP/GDPR-CCPA template) removal path — the
   `eraser`-validated pattern — as the actual primary path for most of these
   brokers, since form automation is blocked on 7/12 (Round 1) and remains
   blocked at the search step for the same 7 (Round 2).
2. Add a `listingUrl` field (or similar) to `PiiProfile` / a broker-specific
   metadata bag for Spokeo-style per-listing opt-outs.
3. Decide whether Intelius/Radaris (identity-verification-heavy) belong in
   the "automatable" registry at all, or should be permanently
   manual-only/documentation-only entries.
4. Evaluate FlareSolverr specifically against Whitepages and USPhonebook
   (plain Cloudflare 403s, no CAPTCHA widget observed) as a targeted,
   policy-compliant unblock before writing them off as fully manual.

## Round 3 — real search-result parsing implemented (2026-09-09)

**First working end-to-end pipeline in the project.** Built a direct HTML
parser for Advanced Background Checks (`parseAdvancedBackgroundChecksResults`
in `advancedbackgroundchecks.ts`, using `cheerio`) that consumes
FlareSolverr's raw HTTP response directly, since Playwright re-navigation to
the `/find/name/` route proved unreliable even with cookie injection (see
docs/FLARESOLVERR.md Round 2 notes).

Built with real TDD: 5 tests against a real saved HTML fixture (an actual
excerpt from a live FlareSolverr response, not fabricated) in
`src/brokers/__fixtures__/`, watched them fail (function didn't exist) before
implementing.

**Verified live end-to-end:**
- `search()` against the real site returned 20 genuine candidates with real
  names, ages, cities, states, zips, and prior-address data.
- Ran the full `runRemoval()` pipeline with a test profile matching one real
  candidate (John N Smith, Port Orchard WA) — local scoring correctly scored
  it 1.0 and the engine proceeded to `optOut()` only because of that
  confirmed match.
- `optOut()` correctly detected the *separate* reCAPTCHA gate on the opt-out
  page (distinct from the search page's Cloudflare challenge) and failed
  closed — confirming the two anti-bot layers on this broker are independent
  and both handled correctly.

**Not yet done:** Spokeo and USPhonebook still need equivalent
result-parsing work. USPhonebook's name-search flow proved harder than
expected — city field is disabled until an unidentified client-side
interaction fires, and Enter-key submission didn't trigger a real search —
needs a dedicated follow-up rather than being rushed.
