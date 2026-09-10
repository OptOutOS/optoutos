# Broker Adapter Authoring Guide

Referenced from `packages/core/src/brokers/types.ts` since the project's
early days; written now (2026-09-10) as part of the adapter-authoring kit,
once 7+ real adapters existed to generalize from rather than guess at
patterns speculatively. This is the guide a contributor (human or
autonomous kanban worker) should read before writing broker #13.

**If you take one thing from this doc:** every claim in an adapter's
docstring must be something you personally observed live, with a real
captured artifact (saved HTML fixture, terminal output, screenshot) backing
it — not something you assumed, inferred from a similar broker, or copied
from documentation. See "Verification discipline" below; it is
non-negotiable and enforced by review.

## Before writing any code

1. **Read `docs/DESIGN.md`** (data flow, key decisions) and
   `THREAT_MODEL.md` (anti-bot policy, payment-paywall policy) — the
   architecture and the two hard policy lines are not re-derived per
   adapter.
2. **Live-probe the broker yourself** — homepage, search flow, opt-out
   flow — via `curl`/`fetch` first (cheapest, fastest signal) and
   Playwright only if the flow needs JS rendering or the anti-bot posture
   requires a real browser. Save what you find:
   - Real HTML into `packages/core/src/brokers/__fixtures__/<broker>-*.html`
     (see spokeo, usphonebook, checkpeople fixtures for the pattern).
   - The exact selectors/field names/endpoints you observed, quoted in the
     adapter's docstring with the date you verified them.
3. **Check `docs/BROKER_STATUS.md`** — someone may have already probed
   this broker in an earlier round; don't re-derive from scratch, but DO
   re-verify live if the finding is more than a few weeks old (see
   CheckPeople Round 10→12 for why: postures genuinely drift).
4. **Register the broker** in `docs/ROADMAP.md`'s priority list per its
   real effort/yield, not speculatively — see DESIGN.md decision 10
   ("no broker dropped for its shape, deprioritize by effort").

## The three proven patterns

Every real adapter in this codebase falls into one of these three shapes.
Pick based on what you actually observe, not what seems cleanest.

### Pattern 1 — Direct Playwright navigation + form fill

Use when: the site is reachable by a normal browser with no persistent
anti-bot challenge (or one that only appears on `optOut()`, not `search()`).

Example: `advancedbackgroundchecks.ts`'s `optOut()`, `usphonebook.ts`.

```ts
async optOut(page: Page, profile: Partial<PiiProfile>): Promise<RemovalResult> {
  const timestamp = new Date().toISOString();
  if (!profile.firstName || !profile.lastName) {
    return this.fail(timestamp, "Missing required name fields");
  }

  await page.goto(this.optOutUrl, { waitUntil: "domcontentloaded" });

  // ALWAYS check for anti-bot before touching selectors — see below.
  if (await hasAntiBotMarkerOnPage(page)) {
    return {
      broker: this.brokerId,
      status: "requires_manual_verification",
      timestamp,
      evidence: { reason: "Anti-bot challenge detected; automation does not bypass it" },
    };
  }

  // Fail closed if the verified selectors are gone (site changed).
  if ((await page.locator("#sfn").count()) === 0) {
    return this.fail(timestamp, "Form structure changed: re-verify");
  }

  await page.locator("#sfn").fill(profile.firstName);
  // ... fill remaining verified fields ...

  // Dry-run: never actually click submit until deliberately enabled.
  return { broker: this.brokerId, status: "requires_manual_verification", timestamp, evidence: { dryRun: true } };
}
```

### Pattern 2 — Raw fetch/FlareSolverr HTML + cheerio parsing

Use when: Playwright navigation to a specific route gets stuck behind a
challenge that FlareSolverr itself clears when called directly (this is a
REAL, observed asymmetry — see `advancedbackgroundchecks.ts` docstring:
FlareSolverr's cookie-injection into a fresh Playwright context did not
reliably clear the same route FlareSolverr solved directly via its own
API). Also use for any site where the response is plain server-rendered
HTML and a full browser adds nothing.

Example: `advancedbackgroundchecks.ts` `search()`, `spokeo.ts` `search()`,
`checkpeople.ts` `search()` (plain `fetch()`, no FlareSolverr needed there
since no Cloudflare challenge was present on that route).

```ts
export function parseMyBrokerResults(html: string): SearchCandidate[] {
  const $ = cheerio.load(html);
  const candidates: SearchCandidate[] = [];
  $('a.result-card').each((_, el) => {
    // Extract ONLY what the broker actually displayed. Never fabricate a
    // field the markup doesn't contain, even if a sibling broker has it.
  });
  return candidates;
}

async search(_page: Page, minimalProfile: Partial<PiiProfile>): Promise<SearchCandidate[]> {
  const flareSolverr = getFlareSolverrClientFromEnv();
  if (!flareSolverr) return [];
  try {
    const solution = await flareSolverr.solve(targetUrl);
    return parseMyBrokerResults(solution.response);
  } catch {
    return []; // fail closed — never guess, never retry indefinitely
  }
}
```

Write the parser's unit tests against a REAL saved fixture
(`__fixtures__/*.html`), never synthetic markup you invented — a parser
that only passes against hand-crafted HTML has verified nothing about the
real site.

### Pattern 3 — Turnstile solver (interactive CAPTCHA)

Use when: the site serves an active Cloudflare Turnstile widget (not just
a passive Cloudflare JS check — see the distinction in
`thatsthem.ts`'s docstring). Per THREAT_MODEL.md, solving is allowed via a
**self-hosted, real-browser solver** only — never a paid third-party
CAPTCHA-farm API.

Example: `thatsthem.ts` — the only adapter with a live Turnstile-solve
integration so far (via `TURNSTILE_SOLVER_URL`, `getTurnstileSolverClientFromEnv()`,
`solveTurnstileOnPage()`). Read that file's docstring and
`packages/core/src/turnstile-solver.ts` / `turnstile-page-helper.ts` before
building a new one — most of the machinery is broker-agnostic.

```ts
const turnstileChallenge = page.locator(".cf-turnstile, #cf-turnstile, [class*='cf-chl-widget']");
if ((await turnstileChallenge.count()) > 0) {
  const solverClient = getTurnstileSolverClientFromEnv();
  if (!solverClient) {
    return { /* requires_manual_verification: no solver configured */ };
  }
  try {
    await solveTurnstileOnPage(page, solverClient);
  } catch (err) {
    return { /* requires_manual_verification: solver failed */ };
  }
}
```

reCAPTCHA/hCaptcha have NO working solver integration in this project yet
— every adapter that hits one (advancedbackgroundchecks, usphonebook) fails
closed to `requires_manual_verification`, per the policy that a challenge
type with no real solver must never be guessed around.

## Anti-bot detection: use the shared helper, don't reimplement it

**Before this kit existed, six adapter files each hand-rolled a slightly
different version of "does this page show an anti-bot marker" — with real,
observed drift between them** (missing hCaptcha in one, missing the
Cloudflare block-page text pattern in another). Don't repeat that mistake.

```ts
import { hasAntiBotMarkerOnPage, detectAntiBotInHtml } from "./detection.js";

// On a live Playwright page (covers CSS widget + fallback HTML text check):
if (await hasAntiBotMarkerOnPage(page)) { /* fail closed */ }

// On raw HTML you already fetched (e.g. a FlareSolverr response):
if (detectAntiBotInHtml(html)) { /* fail closed */ }
```

If you find a marker these functions don't catch, **extend
`packages/core/src/brokers/detection.ts` and its tests** — do not add a
broker-local copy of the selector/regex. Every adapter that uses the
shared helper benefits immediately from the new marker.

If your broker needs an ADDITIONAL, genuinely broker-specific check beyond
the shared set (e.g. `usphonebook.ts`'s rendered-text check for its
specific CAPTCHA copy), that's fine — combine it with the shared helper
(`OR` them together), don't replace it.

## Payment paywalls are a different thing entirely

If the blocker you're hitting is a genuine payment gate (the broker's own
paid product, e.g. CheckPeople's report checkout) rather than anti-bot —
see `docs/DESIGN.md` decision 11 and `THREAT_MODEL.md`. This is opt-in
only via `BrokerAdapter.paywallSearch()` + `OPTOUTOS_ALLOW_PAYWALL_BYPASS`,
never attempted by default, and never implemented by simulating a purchase
or exploiting an access-control flaw.

## The privacy-minimization gate (do not fight this in your adapter)

`engine.ts`'s `runRemoval()` is the ONLY caller that should ever invoke
`optOut()`. It:
1. Calls your `search()` with only `searchFields` (never the full profile).
2. Scores every candidate locally against the full profile.
3. Only calls `optOut()` if a candidate clears `MATCH_CONFIDENCE_THRESHOLD`
   (0.6), passing that specific matched candidate.

Your adapter never needs to (and must never) call its own `optOut()`
directly as a shortcut — that would defeat the entire point of the gate.
If your broker has no public search at all (login-gated, e.g. Intelius),
omit `search()` entirely and document why; `runRemoval()` correctly
surfaces `requires_manual_verification` for that case.

## Fail-closed discipline (non-negotiable)

- If you can't verify a selector/endpoint live, don't implement it —
  return `failed` with an honest error message, not a guess.
- If the broker's markup changes shape from what you verified, detect it
  (e.g. `page.locator("#known-field").count() === 0`) and fail closed
  rather than filling the wrong field or crashing.
- Never fabricate a `SearchCandidate` field the broker didn't actually
  display.
- `search()` should never throw uncaught — wrap network/parsing in
  try/catch and return `[]` on failure (`runRemoval()` also catches, but
  the adapter should fail closed on its own terms with a clear reason).
- `optOut()` should stay dry-run (return `requires_manual_verification` or
  `failed` rather than actually submitting) until the form structure is
  fully verified AND the project has deliberately decided to go live for
  that broker — see ROADMAP.md/issue #8 (first real removal submission).

## Registering the adapter

1. Add the class to `packages/core/src/index.ts`'s export list.
2. Add it to `apps/cli/src/registry.ts`'s `buildRegistry()`.
3. Add a row to `docs/BROKER_STATUS.md`'s summary table with the real
   observed status and evidence — not "should work."
4. Write tests FIRST (TDD) — parser tests against a real saved fixture,
   adapter tests for the fail-closed paths (missing fields, anti-bot
   detected, structure changed).
5. Run the full clean-install gate before considering it done:
   ```sh
   rm -rf node_modules package-lock.json && npm install
   npm run lint && npm run typecheck && npm run build && npm test   # in both packages/core and apps/cli
   ```

## Verification discipline (repeating this because it matters most)

Every fact in your adapter's docstring — selector names, field names,
endpoint URLs, anti-bot posture, whether search returns candidates — must
trace to something you personally did and observed, with the date. "Verify
live, don't assume" is this project's single most important convention;
violating it (shipping a plausible-sounding but unverified adapter) is
worse than shipping nothing, because it looks done when it isn't. See
`docs/BROKER_STATUS.md`'s Round 12 (a real detector bug shipped, caught,
and fixed within the same session) for what the discipline looks like in
practice when it's applied correctly *after* a mistake — better to apply
it *before* one.
