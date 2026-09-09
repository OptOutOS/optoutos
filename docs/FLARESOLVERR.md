# FlareSolverr Integration

[FlareSolverr](https://github.com/FlareSolverr/FlareSolverr) is a self-hosted
proxy that drives a real (undetected) Chrome instance to solve Cloudflare's
**passive** computational/JS "checking your browser" challenges. It does
**not** solve interactive CAPTCHAs (Turnstile, reCAPTCHA, hCaptcha) — its own
README states this explicitly. Using it stays within this project's policy
("anti-bot if easy, otherwise move on" / no CAPTCHA-solving), since it is
outlasting a passive challenge the way a real browser naturally would, not
defeating a human-verification widget.

## Live evaluation results (2026-09-09)

Ran a locally-built FlareSolverr 3.5.0 instance (Python, `undetected_chromedriver`,
Playwright's Chromium bundled as its browser since no system Chrome was
installed) against every broker previously blocked by Cloudflare-family
anti-bot protection:

| Broker | Result | Verified how |
|---|---|---|
| Advanced Background Checks | ✅ **Unblocked** | FlareSolverr returned real 93KB opt-out form HTML (confirmed real `<form>` + name fields present, not just HTTP 200) |
| Spokeo | ✅ **Unblocked** | FlareSolverr returned real 153KB opt-out page HTML (confirmed listing/profile-URL opt-out content present) |
| USPhonebook | ✅ **Unblocked** | FlareSolverr returned real 67KB page HTML with actual form fields present |
| CheckPeople | ❌ Still blocked | FlareSolverr itself reports an IP-level Cloudflare ban ("Probably your IP is banned for this site") — not a challenge type it can solve |
| Whitepages | ❌ Still blocked | Same — IP-level ban reported, not solvable this way |
| That'sThem | ⚠️ **False positive caught** | FlareSolverr reported "Challenge not detected!" / HTTP 200, but the actual response body's `<title>` is still "Security Check" — a Turnstile interactive challenge FlareSolverr cannot solve. **Always inspect actual response body content, never trust FlareSolverr's own status alone.** |

**End-to-end integration verified for real, not just the raw HTTP layer:**
after FlareSolverr solved Advanced Background Checks' and USPhonebook's opt-out
pages, the resulting cookies + user-agent were injected into a **separate,
freshly-launched Playwright browser context**, and a plain `page.goto()` in
that context loaded the real form (confirmed page title, confirmed real form
field text) — proving the intended production pattern: FlareSolverr clears
the network-level challenge once, Playwright does all subsequent interaction
in the same context using the inherited cookie jar.

## Architecture

- `packages/core/src/flaresolverr.ts`:
  - `FlareSolverrClient` — thin HTTP client for a running FlareSolverr instance's `/v1` API.
  - `FlareSolverrClient.isLikelyStillChallenged()` — required safety check (see the That'sThem false positive above); callers must not trust FlareSolverr's own "ok" status without checking this.
  - `primeContextWithFlareSolverr(context, client, url)` — solves the URL and injects the resulting cookies into a Playwright `BrowserContext` for subsequent normal Playwright use.
  - `getFlareSolverrClientFromEnv()` — reads `FLARESOLVERR_URL` from the environment; FlareSolverr is opt-in, never auto-started or assumed present.

## Running FlareSolverr

**Preferred (Docker, if available):**
```
docker run -d --name flaresolverr -p 8191:8191 ghcr.io/flaresolverr/flaresolverr:latest
```

**From source (used for this evaluation, no Docker on this Windows host):**
```
git clone https://github.com/FlareSolverr/FlareSolverr.git
cd FlareSolverr
python -m venv venv
./venv/Scripts/python.exe -m pip install -r requirements.txt
# FlareSolverr only checks for Chrome at src/chrome/chrome.exe (Windows) or
# a system install — CHROME_EXE_PATH env var is NOT read by this version.
# If you don't have Chrome installed, copy a Chromium build there, e.g.
# Playwright's bundled Chromium:
mkdir src/chrome
cp -r "$LOCALAPPDATA/ms-playwright/chromium-<version>/chrome-win64/"* src/chrome/
cd src && python flaresolverr.py
```

Then set `FLARESOLVERR_URL=http://localhost:8191` for adapters to use it.

## Honest gaps / next steps

- Adapters for Spokeo and USPhonebook have NOT yet been rewritten to use
  `primeContextWithFlareSolverr()` in their actual `search()`/`optOut()`
  implementations — the evaluation above proved the raw pattern works for
  their opt-out pages, but adapter code itself is still the old
  direct-Playwright version. That rewiring is the next concrete task.
- **Advanced Background Checks was partially rewired and the result is
  mixed, not a clean win — documented precisely rather than overclaimed:**
  `search()` was updated to call `primeContextWithFlareSolverr()` before
  navigating to the `/find/name/{term}` route. Calling FlareSolverr's raw API
  directly against that exact URL DOES solve it (confirmed: 320KB real
  results page, correct title "John Smith - Public Records Search..."). But
  when the adapter primes a **separate** Playwright context with cookies from
  solving the *same* URL and then does a plain `page.goto()` to it, the page
  still shows "Just a moment..." — the passive challenge was NOT bypassed via
  the cookie-injection pattern for this specific route, even though it works
  for the `/opt-out` route. Likely cause: this route's Cloudflare challenge
  may be tied to more than cookies (e.g. a per-request or session-storage
  token FlareSolverr's own browser retains but a fresh Playwright context
  does not inherit). **Do not assume the cookie-injection pattern
  generalizes to every URL on a domain just because it worked for one route
  on that domain — verify per-URL.** Additionally, FlareSolverr's own logs
  during this evaluation showed **inconsistent solve times/success for this
  exact URL across separate calls** — one attempt timed out at 60s, another
  succeeded in ~35s — so this route's challenge difficulty may itself be
  variable (server-side risk scoring, rate limiting, etc), not just a
  cookie-injection limitation. Treat any single pass/fail on this route as
  provisional; do not conclude "solved" or "unsolvable" from one attempt.
- Given the above, the more reliable (if less elegant) integration for
  routes where cookie-injection fails is: use FlareSolverr's own returned
  `response` HTML directly for search-result parsing (plain HTML parsing,
  no Playwright needed for that step) rather than trying to get Playwright
  to reach the same page live. This has NOT been implemented yet — noted as
  the corrected next step for Advanced Background Checks specifically.
- USPhonebook's real name-search UI is a JS tab-switcher (`[data-search-tab]
  [data-search-type="name"]`) that changes which input is "visible" via a CSS
  class rather than page navigation; the visible name-search input fields
  were located in the DOM after dispatching a click event, but full
  extraction of real search-result-listing selectors was not completed in
  this session — needs one more verification pass before `search()` can be
  implemented for real result data.
- FlareSolverr does not help CheckPeople, Whitepages, or That'sThem — these
  remain genuinely blocked (IP ban or interactive CAPTCHA respectively) and
  should stay `requires_manual_verification` rather than have further effort
  spent chasing an unblock this way.
