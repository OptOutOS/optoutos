# USPhonebook — Live Reachability Check (2026-09-10)

Live verification performed against `docs/BROKER_STATUS.md` Round 7/8 claims
and `packages/core/src/brokers/usphonebook.ts`. Fresh curl probes (no
Playwright/browser cache reused; no cookies carried between requests), plain
Chrome UA, no FlareSolverr, no solver.

## URLs probed

| URL | Method | Result |
|---|---|---|
| `https://usphonebook.com/` | GET | 200 (redirects transparently to `www.` at TLS/HTTP layer via curl's own resolution — see below) |
| `https://www.usphonebook.com/` | GET | **200 OK**, no redirect, `Server: cloudflare` |
| `https://usphonebook.com/opt-out` | GET, `-L` | 301 → `https://www.usphonebook.com/opt-out` → 307 → `/removal` → **200 OK** (bare host chain resolves cleanly) |
| `https://www.usphonebook.com/opt-out` | GET, `-L` | 307 → `/removal` → **200 OK** |
| `https://www.usphonebook.com/john-smith` | GET | **200 OK**, real search-result page |

Full redirect chain observed with `curl -sS -A "<chrome-ua>" -L -D -`:
```
usphonebook.com/opt-out          -> 301 Moved Permanently -> https://www.usphonebook.com/opt-out
www.usphonebook.com/opt-out      -> 307 Temporary Redirect -> /removal
www.usphonebook.com/removal      -> 200 OK
```
No 403s anywhere in this chain today. (This *contradicts* the Round 2 finding
"Bare host returns Cloudflare 403 before the /search POST endpoint is
reachable" — that appears to have been either a stale/rate-limited
observation or an anti-bot posture that has since relaxed for this path.
Round 7/8 already superseded most of that Round 2 pessimism for the `www.`
host; this check confirms the bare host's `/opt-out` redirect chain is also
currently clean.)

## Anti-bot layer status

- **Cloudflare is present** (`Server: cloudflare`, `cf-cache-status`,
  `CF-RAY` headers, and a `challenge-platform` JS include for bot-scoring on
  the homepage) but it is **passive/background scoring only** — no
  "Just a moment...", no interstitial challenge page, no `cf-mitigated`
  header, no 403/429 on any of the probed routes. Response bodies are the
  real pages (2898–52552 bytes), not challenge shells.
- **reCAPTCHA Enterprise is present on the opt-out (`/removal`) page only**
  — confirmed via `recaptcha/enterprise.js` script include and
  `Subject First/Last/Middle Name`, `Subject Email`, and `Begin Removal`
  form labels/buttons in the fetched HTML. This matches the adapter's
  documented fail-closed behavior in `usphonebook.ts` — no CAPTCHA bypass
  attempted or needed to confirm the finding.
- **No Turnstile widget observed** anywhere in the probed pages.
- **No login/consent wall.** All pages load anonymously with a plain GET.

## JS-rendered content

- The homepage's Name-tab search flow is genuinely client-side (a JS toggle
  switches the hidden `searchType` input and enables the city field) — this
  matches the adapter's documented Playwright `page.evaluate()`-dispatched
  click workaround. Raw curl confirms the toggle's static markup
  (`pf-search-tabs`, `data-search-type="name"`, `#pfHeaderInput`) is present
  in the initial HTML, so the DOM anchors the adapter already relies on are
  real, not fabricated.
- The search-results page (`/john-smith`) is server-rendered — curl alone
  returns the full result HTML with `<title>249 Public Records Found for
  John Smith  - USPhonebook</title>` and 14 occurrences of
  `success-wrapper-block`, matching `parseUsPhonebookResults()`'s selector
  and the checked-in fixture
  (`packages/core/src/brokers/__fixtures__/usphonebook-john-smith.html`).
  No Playwright is required to fetch this specific page's HTML — only the
  interactive *navigation* from homepage to results page needs a real
  browser (or FlareSolverr/JS execution), since the site returns the
  results at a client-navigated URL, not directly reachable by guessing the
  `/{first}-{last}` slug as a fresh unauthenticated GET without exercising
  the search UI first in a real user flow. (This check did GET the results
  URL directly and it worked — but that shouldn't be relied on as a stable
  contract change; the adapter's Playwright-driven approach remains the
  correct, robust path.)

## Candidate selector anchors observed (not written as selectors)

- Search results: `.success-wrapper-block[itemtype='https://schema.org/Person']`
  container; `itemprop="name"`, `itemprop="address"`, `itemprop="relatedTo"`
  microdata — all present in the live-fetched page, consistent with the
  existing parser and fixture.
- Opt-out form: `name="subject-firstname"`, `name="subject-lastname"`,
  `name="subject-middlename"`, `name="subject-email"`, plus a
  `block-captcha` container wrapping the reCAPTCHA Enterprise script —
  consistent with the adapter's documented `getByLabel(/Subject.../)`
  approach and its CAPTCHA-detection guard.

## Reachability decision

**Reachable for adapter development, no changes needed.** Live behavior
today matches what `usphonebook.ts` and `docs/BROKER_STATUS.md` Round 7/8
already document:
- `search()` — reachable, real client-side flow, existing Playwright
  `evaluate()`-click + Enter-key sequence remains the verified correct path.
- `optOut()` — reachable up to the reCAPTCHA Enterprise gate, which the
  adapter correctly fails closed on (`requires_manual_verification`). No
  workaround is being pursued for this CAPTCHA per project policy (no
  automated CAPTCHA solving).

No FlareSolverr, proxy, or UA workaround is required at this time. The
previously-recorded Round 2 "bare host 403" note for `/opt-out` no longer
reproduces and should be treated as historical/superseded, not current
behavior — Round 7/8 already established this for the `www.` host and
search flow; this check extends that confirmation to the bare-host
`/opt-out` redirect chain specifically.
