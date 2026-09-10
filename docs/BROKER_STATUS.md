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
| ClustrMaps | — | Not testable | `clustrmaps.com` resolves (via DoH, bypassing local sinkholing) to `5.39.10.93`, but that IP serves Imena.ua's registrar parking page on port 80 for every path (homepage, opt-out route, and a random nonexistent path all byte-identical) and resets the TLS handshake on port 443 before any content is served — re-verified live 2026-09-10. The ClustrMaps application itself is not being served from this domain/IP; no adapter can be built until the site is reachable again. No selectors invented. |
| That'sThem | form | `requires_manual_verification` | Real form fields verified (`#name #street #city #state #zip #email #phone`). Cloudflare Turnstile challenge served to automated browsers; adapter detects and fails closed, per no-CAPTCHA-solving policy. |
| Advanced Background Checks | form | `requires_manual_verification` | Direct name/email opt-out form found (`#mode #sfn #smn #sln #semail`), protected by reCAPTCHA. Fails closed. |
| BeenVerified | form | `requires_manual_verification` | Both search/opt-out routes redirect to a JS app shell exposing hCaptcha/Cloudflare Turnstile markers. No selectors guessed. |
| CheckPeople | form | `failed` (dry-run, honest limitation — Round 12) | `search()` performs a real live navigation (homepage → CSRF token → `POST /landing` → `GET .../results`, re-verified live on every call) but always returns `[]`: CheckPeople's free-tier results page carries no reliable match/no-match signal (see Round 12 — Round 11's detector was found to be a real bug and reverted). `optOut()` still fails closed — no opt-out form structure has been live-verified yet. |
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

**Not yet done:** Spokeo and USPhonebook still need the equivalent
result-parsing work. USPhonebook's name-search flow proved harder to
automate than expected (city field is disabled until some client-side
interaction fires; Enter-key submission didn't trigger a real search) —
needs a dedicated follow-up session rather than being rushed.

## Round 4 — Turnstile solver integration (2026-09-09)

Per the revised anti-bot policy (THREAT_MODEL.md "Anti-bot / CAPTCHA
policy"), built and verified a real Turnstile-solving integration:
`turnstile-solver.ts` (`TurnstileSolverClient`, solver-agnostic HTTP client)
and `turnstile-page-helper.ts` (`solveTurnstileOnPage()` — detects a
`cf-turnstile` sitekey on the current page, solves it, injects the token
into the page's `cf-turnstile-response` hidden input). Wired into
`thatsthem.ts` as the reference integration.

**Verified live, end to end, with a real self-hosted EzSolver instance**
(https://github.com/ismoiloffS/EzSolver):
- Real solve via curl and via our actual TypeScript `TurnstileSolverClient`
  against Cloudflare's own public test sitekey (`1x00000000000000000000AA`)
  — both returned the expected `XXXX.DUMMY.TOKEN.XXXX` response.
- Real `solveTurnstileOnPage()` end-to-end: extracted a sitekey from real
  page HTML, called the live solver, and confirmed the token was correctly
  injected into a `cf-turnstile-response` input on the page.

**Real environment issue found and fixed while setting this up:** running
`TS_PROFILE_DIR` through git-bash's `$TEMP` produced a POSIX-style path
(`/tmp/...`) that native Windows `chrome.exe` cannot create/write to,
causing an opaque "Failed to connect to browser... running as root" error
from nodriver that had nothing to do with sandboxing. Root cause confirmed
by testing EzSolver's standalone CLI mode (which uses its own internal
Windows-correct default profile path) successfully first, isolating the
issue to the environment-variable path mangling rather than EzSolver's code
or nodriver itself. Fix: don't override `TS_PROFILE_DIR` from a bash shell
on Windows; let it use its own OS-aware default.

**Not yet re-verified:** That'sThem's live anti-bot posture appears to have
shifted again since the last check — a fresh headless Playwright request to
`thatsthem.com/optout` now returns a flat CloudFront 403 ("The request could
not be satisfied") before any Turnstile widget is even served, rather than
the Turnstile challenge previously documented. This means the solver
integration itself is verified working, but a full live end-to-end proof
specifically against That'sThem's real opt-out page is currently blocked by
this new 403, not by the solver. Re-check when That'sThem's anti-bot posture
stabilizes, or pursue a different broker's Turnstile challenge as the live
proof target instead.

## Round 5 — live re-survey of the remaining blocked brokers (2026-09-09)

Re-checked all currently-blocked adapters live (not from memory/docs) after
the Turnstile solver landed, to find the next real integration target
instead of guessing:

- **BeenVerified — new blocker class found, not just anti-bot.** The
  documented `/app/optout/search` route now redirects straight to
  `beenverified.com/login` ("Join today / Sign In") before any opt-out form
  is reachable. That login page does carry a real, live Cloudflare Turnstile
  widget (sitekey `0x4AAAAAAANy10csBBDGj3lU`, confirmed via `data-sitekey`),
  so the *solver* would work on it — but the actual obstacle is that
  BeenVerified now appears to require an authenticated account before their
  opt-out flow is reachable at all. Creating/managing a third-party account
  on the user's behalf is out of scope for this project (no credential
  vending beyond the user's own configured PII/BWS sources) — this is
  **not** a Turnstile-solver problem and needs a separate policy decision,
  not code, before further work here. A second candidate URL from public
  opt-out guides, `beenverified.com/svc/optout`, was also tried directly via
  FlareSolverr raw-fetch: it serves a much harder Cloudflare JS challenge
  that did not clear even at a 130s timeout (FlareSolverr's own log:
  `Challenge detected. Title found: Just a moment...` → `Error solving the
  challenge. Timeout after 130.0 seconds.`), so that route is currently a
  dead end via both approaches tried.
- **Whitepages — status re-confirmed, not resolved.** The bare homepage
  `whitepages.com/` now returns a normal 200 (this differs from an earlier
  "IP banned" note and could look like progress at a glance), but the actual
  *functional* search route (`whitepages.com/name/{name}`) still returns
  Cloudflare's interstitial block page ("Sorry, you have been blocked... You
  are unable to access whitepages.com") with no Turnstile/CAPTCHA widget at
  all — this is a network/IP-reputation-level block that a Turnstile solver
  cannot address. No change to this broker's real status: still blocked,
  root cause still IP-level rather than anti-bot-challenge-level.

**Conclusion of this survey:** of the adapters not yet using the solver
(CheckPeople, Whitepages, Intelius, Radaris, InfoTracer, PublicDataUSA),
none currently present a "clean" interactive-Turnstile-only blocker the way
That'sThem did when its adapter was written — they're either IP-banned
(Whitepages, CheckPeople) or now account-gated (BeenVerified), which the
solver doesn't help with. That'sThem itself is the correct integration to
keep re-verifying once its current CloudFront 403 clears, since it's the
one broker confirmed (this session) to have a real, code-level Turnstile
integration point. No further broker-status changes made this round beyond
documenting these live findings.

## Round 6 — real Spokeo search-result parsing (2026-09-09)

**Spokeo now has real, live-verified search()**, the second broker (after
Advanced Background Checks) to move off `requires_manual_verification` for
search. Direct Playwright navigation to any spokeo.com URL still returns a
flat HTTP 403 in this project's runtime (confirmed unchanged during Round
5's survey), but — same pattern proven for ABC — a FlareSolverr raw-fetch of
`https://www.spokeo.com/{First}-{Last}` cleared cleanly: FlareSolverr itself
reported "Challenge not detected!" and returned a real, fully-populated
results page (a live capture, 70,726 matches for "John Smith", saved as
`src/brokers/__fixtures__/spokeo-john-smith.html`).

Card structure (verified against the real fixture, not guessed):
`<div role="listitem">` per person, `<h3><a href="/John-Smith/{State}/{City}/{id}">
{Name}, Age {N}</a></h3>`, a `"Resides in {City}, {ST}"` / `"Resided in
{City}, {ST}"` heading (both wordings occur — the latter for deceased
listings), and a `Relatives:` label followed by sibling `<a>` tags.
`parseSpokeoResults()` (cheerio-based, 7 TDD tests) extracts all of this.

**Two real bugs found and fixed via TDD, not caught by a naive
implementation:**
1. The "Resides in" vs "Resided in" wording differs by listing (deceased vs
   living) — an initial regex anchored to only one wording silently dropped
   city/state for roughly half of real candidates.
2. A naive "find all `<a>` tags near the Relatives label" selector picked up
   the candidate's own name link too (it lives in the same wrapping `<div>`
   in the real markup), so the first relative extracted was always the
   listing's own name (self-referential). Fixed by walking only the actual
   sibling elements immediately after the `Relatives:` label span, not the
   whole shared container. Both bugs now have permanent regression tests.

Live end-to-end verified through the real `SpokeoAdapter.search()` class
(not just the standalone parser) against a live self-hosted FlareSolverr
instance: 30 real candidates returned, including correct 2-letter state
codes and relative names with no self-inclusion. `search()` fails closed to
`[]` if `FLARESOLVERR_URL` is unset or the fetch is still challenged — same
convention as ABC.

**Not yet done:** `optOut()` is unchanged — Spokeo's opt-out flow still
requires a broker-issued listing URL per profile that a `PiiProfile` alone
cannot supply, so opt-out remains `requires_manual_verification` even
though search now works. A future improvement could thread a matched
candidate's `candidateId` (the profile URL path) from `search()` into
`optOut()` via the engine, but that's a real design change to
`runRemoval()`'s interface, not done here — documented as a gap, not
silently left unexplained.

83 → 90 core tests. Lint/typecheck/build clean.

## Round 7 — real USPhonebook search-result parsing, and a stale finding corrected (2026-09-09)

**USPhonebook now has real, live-verified search()** — the third broker
with working search. This also **corrects a wrong earlier conclusion**: the
adapter's docstring previously said the Name-tab flow was genuinely broken
("city field disabled until an unidentified interaction; Enter key doesn't
submit"), and search() failed closed to `[]` unconditionally as a result.
Re-verified live, that conclusion was wrong:

- `www.usphonebook.com` (not the bare `usphonebook.com` host, which does
  return a real HTTP 403) loads fine.
- The Name tab **is** a working client-side toggle. A genuine Playwright
  `.click()` times out on it — but only because the tab button renders
  outside the headless viewport (a real layout/CSS quirk), not because the
  control itself is broken. Dispatching the click via `page.evaluate()`
  works correctly and enables the previously-"disabled" city field.
- Pressing Enter in the now-enabled name field navigates to a genuine
  `/{first}-{last}` results page — but only when the initial page load used
  `waitUntil: "networkidle"`. With `domcontentloaded`, the same sequence
  silently falls through to a dead `/search` route instead, because the
  page's autocomplete/submit JS isn't fully attached yet. This was caught
  by a real failed live-verification run (0 candidates on first live try,
  despite fixture-based unit tests passing) — re-run with more careful
  timing found the actual cause instead of accepting a false negative.
  Raw `form.submit()` also does not work (hits the same dead `/search`
  route); only the real Enter-key path is correct.

Card structure (verified against a real fixture, not guessed):
`<div class="success-wrapper-block" itemscope itemtype="https://schema.org/Person"
itemid="https://www.usphonebook.com/{slug}/{id}">` with schema.org Person
microdata throughout — `itemprop="name"`, `itemprop="address"` (current +
prior), and `itemprop="relatedTo"` wrapping each relative's own nested
Person microdata (no self-inclusion risk the way Spokeo's flat sibling-`<a>`
markup had, since relatives are structurally distinct nodes here).
`parseUsPhonebookResults()` (cheerio, 5 TDD tests) extracts all of this.

Live end-to-end verified through the real `UsPhonebookAdapter.search()`
class (not just the standalone parser), run twice for consistency given the
timing-sensitive fix: 10 real candidates both times, correct cities/states,
zero self-referential relatives.

**Not yet done:** `optOut()` is unchanged — still fails closed on the
verified reCAPTCHA gate. As with Spokeo, threading a matched candidate's
profile URL from `search()` into `optOut()` would need the same
not-yet-designed `runRemoval()` engine change.

90 → 95 core tests. Lint/typecheck/build clean on both packages
(140 tests total: 95 core + 45 CLI).

**Broker coverage after this round: 3 of 12 brokers have real, live-verified
search** (advancedbackgroundchecks, spokeo, usphonebook) — the full set of
brokers previously known to be FlareSolverr/browser-reachable. The
remaining 9 are IP-banned, account-gated, DNS-dead, or genuinely
anti-bot-blocked at a level not yet unlocked (see Rounds 4-6 above).

## Round 8 — Spokeo opt-out route blocked (403), and a real tooling
outage found + fixed (2026-09-09/10)

**Spokeo's `/optout` page (and `/opt-out`, `/opt_out`, and the `www.`
variants of each) returns a flat 403 Forbidden (117-byte body)** via both
direct Playwright and FlareSolverr's raw-HTML fetch. FlareSolverr itself
logs "Challenge not detected!" for this route — i.e. this is a server-side
WAF block, not an interactive Cloudflare/Turnstile challenge a solver could
clear. Cross-checked against privacyguides.org's current data-broker-removal
guidance: the `/optout` URL itself is correct and current, so this isn't a
stale-route mistake — it's a genuine, currently-in-place access block on
just the opt-out path (search still works fine on the same domain).

**Decision:** hold all `optOut()` selector work for Spokeo until the page is
verifiably reachable again. Writing form selectors against a page you can't
load would mean guessing, which this project's verification discipline
explicitly forbids (see CONTRIBUTING.md's "Broker adapter changes" section).

Separately, this round also investigated and fixed a real correctness gap:
`runRemoval()` and every working adapter's `optOut()` already accept a
`candidate` parameter, but no adapter's `optOut()` implementation actually
*uses* it yet. Checked which of the 3 real-search brokers would need it:
ABC and USPhonebook's opt-out forms are name+email-based (no
broker-issued per-listing URL required), so they don't block on this;
only Spokeo's opt-out flow needs a listing URL from `search()`, and that
work is exactly what's on hold above.

### Recurring-run scheduling + audit logging (not a broker-verification
round, but built and live-verified this session)

Added two related capabilities directly motivated by the question "should
scheduling rely on a running log, or a value stored somewhere — we're
already storing PII?":

- **`packages/core/src/logging/run-logger.ts`** — an append-only, non-PII
  JSONL audit log (`JsonlRunLogger`). Records `personId` (an opaque UUID,
  never a name), broker, status, timestamp, and the adapter's own
  already-non-PII evidence. This answers "what happened and when" for
  debugging, independent of the encrypted store.
- **`packages/core/src/scheduling/`** — `isDue()` and
  `runScheduledChecks()`. The scheduler's source of truth for "is this
  broker due for a re-check" is a compact `brokerRunHistory` rollup added
  directly to the (already-encrypted) `PersonRecord` schema — not the JSONL
  log. Rationale: the rollup travels with the person and is deleted when
  they're deleted, with no second unencrypted copy of PII-adjacent state;
  the JSONL log is a separate, disposable audit trail. Default re-check
  interval is 100 days, cited from privacyguides.org's published guidance
  (re-check every 3-4 months).
- New CLI command `schedule-run --store <path> [--broker <id>...]
  [--execute]`, same dry-run-by-default gate as `run`. See
  docs/SCHEDULING.md for cron/Task Scheduler setup.
- **Live end-to-end verified** through the real CLI against a real
  encrypted household store: first `schedule-run` correctly ran and logged;
  an immediate second run correctly reported "0 checked, 1 not yet due"
  from the persisted encrypted rollup; confirmed zero plaintext PII on disk
  via `grep`.

95 → 117 core tests (117 core + 50 CLI = 167 total).

### A real tooling outage found during unrelated dependency cleanup

While consolidating duplicated `devDependencies` (root vs. `apps/cli` vs.
`packages/core` had drifted out of sync across PRs — the proximate cause of
a user-reported "why are you using old versions" complaint about PR #6),
a genuinely clean reinstall (`rm -rf node_modules package-lock.json && npm
install`) revealed that the earlier PR #6 merge (TypeScript 5.9 → 7.0.2)
was actually broken: TypeScript 7 is Microsoft's new Go-based rewrite, a
different compiler architecture, and `@typescript-eslint` (no release
newer than 8.70.0 exists) still hard-requires `typescript >=4.8.4 <6.1.0`
as a peer dependency — no TS7 support exists yet. The earlier "clean
install" verification that approved PR #6 wasn't actually clean: it reused
an existing lockfile where TypeScript 5.9.3 was still hoisted at the
workspace root, masking the conflict.

**Fix:** replaced ESLint + `@typescript-eslint/parser` +
`@typescript-eslint/eslint-plugin` with **Rslint** (`@rslint/core`), an
ESLint-compatible linter built natively on typescript-go (the same engine
TS7 uses), so there's no compiler-API version mismatch to break. A second,
independent bug was found and fixed *during* this migration, before
trusting the new tool: a shared root-level `rslint.config.ts` referenced
from a sub-package via `--config ../../rslint.config.ts` (or run with a
mismatched CWD) silently dropped type-aware rules with **no warning or
error** — "lint passed" even against code with real, injected violations.
Root cause: type-aware rule discovery needs the config file itself
co-located with (or an ancestor of) the linted package's own
`tsconfig.json`. Fixed with a per-package `rslint.config.ts` that imports
shared rule definitions from a root `rslint.shared.ts` module — never a
config referenced cross-directory. CI also needed a Node 20 → 22 bump
(Rslint requires Node ≥22.6 for native `.ts` config file loading; this
broke the very next push and was caught immediately by CI, not silently).

Verified before calling any of this done: a real `rm -rf node_modules
package-lock.json && npm install` succeeds with 0 vulnerabilities; both
packages pass lint/typecheck/build/test (167/167); deliberately injected a
throwaway unused-variable violation into each package and confirmed Rslint
actually flags it (69 active rules in both) before removing it; confirmed
`eslint-disable-next-line` comments still suppress rules; live-built and
smoke-tested the CLI (`list-brokers`); CI and CodeQL both green on `main`.

## Round 9 — PublicDataUSA re-verified unreachable; test gap closed
(2026-09-09)

Re-ran live DNS verification for `publicdatausa.com` against three
independent resolvers: the local UDM Pro resolver (192.168.1.1), Cloudflare
(1.1.1.1), and Google (8.8.8.8). All three still return `SERVFAIL` with no
address; a direct `curl` also fails to resolve the host. This confirms the
Round-prior finding still holds — the domain has not come back — so no
opt-out selectors were written and the placeholder adapter's fail-closed
behavior is unchanged.

**Real gap found and fixed:** `PublicDataUsaAdapter` had no test file at
all, unlike every other adapter in the module (e.g.
`thatsthem-turnstile.test.ts`, `advancedbackgroundchecks.test.ts`). Added
`publicdatausa.test.ts` (3 tests) asserting: no required/search fields are
declared, `optOut()` always fails closed with a `DNS_BLOCKED` evidence
marker and never touches the Playwright `page` object, and the returned
timestamp is valid ISO 8601. Full quality gates re-run clean: `npm test`
(170/170: 120 core + 50 CLI), `npm run lint` (Rslint, 0 issues, both
packages), `npm run typecheck` (both packages), `npm run build` (both
packages).

**Status: still correctly `failed` (domain unreachable).** No other
PublicDataUSA action is safe to take until `publicdatausa.com` resolves
again.

## Round 10 — CheckPeople reachability contradicts stale "IP-banned" claim;
kanban board audit (2026-09-10)

**CheckPeople is not stably IP-banned.** A synthetic end-to-end search
(homepage → CSRF-token scrape → `POST /landing` → `GET /searching` →
`GET /results`, fake identity "Zaphod Beeblebrox, Fargo ND") completed
cleanly with zero anti-bot challenges via plain `curl`, no solver, at
2026-09-10 10:35 — directly contradicting `docs/FLARESOLVERR.md`'s
2026-09-09 claim of an IP-level Cloudflare ban. Full endpoint spec,
required cookies, and the real "no results" signal (`#modifySearchModal`,
NOT the "10+ Results" headline, which is generic marketing text shown even
for zero real matches) captured in `docs/checkpeople-reachability.md`.

**But the posture is genuinely inconsistent, not simply "actually open
now"**: an independent re-check roughly an hour later hit a Cloudflare
"Under Attack Mode"-style JS-challenge redirect on the same homepage.
`docs/FLARESOLVERR.md` updated to reflect fluctuating status rather than
either fixed extreme. `packages/core/src/brokers/checkpeople.ts` still
hard-codes `search() -> []` on the old assumption — flagged as needing a
live re-probe rather than a hard-coded verdict, not fixed in this round.

**Separately: audited the `optoutos` kanban board itself** (82 tasks,
found via a stray `.worktrees/` directory — see GitHub issue #10, closed).
Found and fixed: `kanban.dispatch_in_gateway` had reverted to `true`,
contradicting the board's deliberate cost-control pause; reset to `false`
and the gateway restarted to apply it. Found and merged two more real,
unmerged worker findings sitting in worktrees since the accidental
dispatch window (ClustrMaps re-confirmation — commit `f10376d`; this
CheckPeople doc). Board task chains reviewed against current project
direction; misaligned chains (BeenVerified full adapter build ahead of an
undecided account-gating policy; Whitepages chain assuming a solver can
fix an IP-level block) addressed separately — see DESIGN.md decision #9
and the board itself for the resulting blocks/edits.

## Round 11 — CheckPeople real search implemented (TDD), live-verified
(2026-09-10)

Following Round 10's finding, implemented `CheckPeopleAdapter.search()` for
real, replacing the old hard-coded `[]`. TDD: `checkpeople.test.ts` written
first (4 tests, RED confirmed — `checkPeopleHasNoMatch` didn't exist yet),
then implemented against two real captured fixtures
(`__fixtures__/checkpeople-home.html`, `__fixtures__/checkpeople-no-match.html`)
independently re-verified live before writing any code (not just trusting
the Round 10 doc): reproduced the exact same homepage → CSRF-token scrape
→ `POST /landing` → `GET .../results` sequence via plain `curl`, got the
exact same `searchId` prefix format and empty-result modal, confirming the
Round 10 finding still held at implementation time.

**Design decisions:**
- Plain `fetch()`, no Playwright/FlareSolverr — the whole flow is
  server-rendered HTML over ordinary HTTP, nothing here needs a browser.
- Only sends `firstName`/`lastName` (+ `city` if known) — the broker's own
  search form requires no more, per the project's minimal-PII-search
  principle.
- `checkPeopleHasNoMatch()` only recognizes the verified empty-result
  modal signal (`#modifySearchModal` "No results found"), never the
  generic "10+ Results" marketing headline (present even for zero real
  matches — see Round 10). No positive-match card parser exists yet: a
  real result card's structure has never been observed live (this
  project's verification policy forbids probing with a real person's
  name), so any non-empty-non-recognized shape fails closed to `[]`
  rather than guessing at candidate fields.
- `search()` re-probes live on every call — no caching, no hard-coded
  verdict — consistent with Round 10's finding that posture fluctuates.

**Live-verified end-to-end**, not just the fixture-based unit tests: built
the adapter, ran `search()` against the real live site with the same
synthetic identity, got the real `[]` no-match result over an actual
network round-trip matching the manual `curl` reproduction. `optOut()`
unchanged (still fails closed — no opt-out form structure verified yet).

Full clean-install verification: `rm -rf node_modules package-lock.json &&
npm install` succeeds with 0 vulnerabilities; both packages
lint/typecheck/build/test clean. **124 → core tests, 174 total (124 core +
50 CLI).**

## Round 12 — Round 11's no-match detector was a real bug; corrected (2026-09-10)

The user gave explicit permission to probe search with generic/common
names ("You can def probe search with generic names. Just never
`optOut()` without real intent to remove data.") — this immediately paid
off. Round 11's `checkPeopleHasNoMatch()` used the `#modifySearchModal`
"No results found" text as the no-match signal, verified only against a
synthetic identity ("Zaphod Beeblebrox") guaranteed to have zero real
matches.

Re-probing live with a real common name ("John Smith") and diffing the
two `/results` responses line-by-line found they are **byte-for-byte
structurally identical** apart from the name itself — same "We found 10+
Results" headline, same `#modifySearchModal` "No results found" markup,
same "Preparing to build report" loading shell, same forced 4-second
client-side JS redirect into a paid report/checkout funnel
(`open-report/step1-opening`, which contains `credit`/`checkout` markup —
not explored further; this project does not simulate a purchase).

**Conclusion: CheckPeople's free-tier `/results` page carries no match/
no-match signal at all.** It is a generic pre-loader/paywall-teaser shell
served identically regardless of actual result count; the real result
data (if any) is gated behind checkout. Round 11's detector was
confidently wrong — worse than the pre-Round-11 honest `[]` stub, because
it *looked* implemented and verified while actually reporting "no match"
unconditionally, for any query, real or synthetic.

**Fix:** `checkPeopleHasNoMatch()` now always returns `false` (documented
as a permanent limitation, not a bug to fix later) and `search()` always
returns `[]`, but the real live navigation is still performed on every
call so reachability continues to be genuinely re-verified rather than
assumed. Tests rewritten as regression tests locking in the corrected
behavior against both the synthetic fixture and the real John Smith
response shape. Full sweep re-run clean.

This is exactly the failure mode "verify, don't assume" exists to catch,
and it worked — the fix landed within the same session because the user's
own probing permission surfaced it immediately, before it could ship
further or mislead a future session into trusting a broken detector.
