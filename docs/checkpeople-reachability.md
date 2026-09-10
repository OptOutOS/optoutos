# CheckPeople Search Endpoint Probe (2026-09-10)

Synthetic identity used: firstName=Zaphod, lastName=Beeblebrox, city=Fargo, ND
(no real person; chosen to guarantee an empty/no-match result).

## Live status at probe time

No active anti-bot challenge encountered. Cloudflare + Reblaze/Imperva (`__uzm*`
cookies) present but passive — no Turnstile/CAPTCHA served, no IP-ban response
(contradicts the stale claim in `docs/FLARESOLVERR.md` 2026-09-09 that
CheckPeople is IP-banned — re-verify per-session before trusting that doc;
see "Doc staleness" below). Confirms prior parent tasks t_0ffa4c8a / t_ec610741.

## Step 1: GET homepage (token + form discovery)

    GET https://checkpeople.com/
    -> 200 OK, text/html (86KB)
    Headers of interest: Server: cloudflare, cf-cache-status: DYNAMIC
    Set-Cookie: __uzma/__uzmb/__uzmc/__uzmd/__uzme (Reblaze fingerprint, HttpOnly),
                XSRF-TOKEN, laravel_session (HttpOnly), __cf_bm (HttpOnly, Secure)

Search form (`#navTabPeople`), method inferred POST (no explicit method attr,
Laravel default POST), action `https://checkpeople.com/landing`:

    <input type=hidden name=_token value="<CSRF token, scraped fresh per session>">
    <input type=hidden name=aid value="11">
    <input type=text name=firstName required>
    <input type=text name=lastName required>
    <input type=text name=city>

_token must be scraped live from this page each session — it's a per-session
Laravel CSRF token, not static.

## Step 2: POST search

    POST https://checkpeople.com/landing
    Content-Type: application/x-www-form-urlencoded
    Cookies required: XSRF-TOKEN, laravel_session, __cf_bm, __uzm* (from step 1)
    Headers: standard browser UA + Referer: https://checkpeople.com/
    Body (urlencoded): _token=<csrf>&aid=11&firstName=Zaphod&lastName=Beeblebrox&city=Fargo%2C+ND

    -> 302 Found
       Location: https://checkpeople.com/landing/people/{searchId}/searching?_token=...&aid=11&firstName=zaphod&lastName=beeblebrox&city=fargo-nd&state=

`{searchId}` is a short opaque alphanumeric id assigned per search (e.g. `gc1f`
in this run) and echoed in all subsequent URLs. Note query params are
lowercased/slugified by the server in the redirect Location.

## Step 3: GET the "searching" interstitial

    GET https://checkpeople.com/landing/people/{searchId}/searching?_token=...&aid=11&firstName=...&lastName=...&city=...&state=
    -> 302 Found (this run: redirected to a NEW searching URL with a
       different transient id, e.g. .../people/tl0alt/searching)

This route is a transient status/redirect step (mirrors "processing" state) —
it 302s again rather than returning content. Only relevant if building a
polling loop; safest immediate action is to skip straight to `results` using
the ORIGINAL `{searchId}` from Step 2's Location header (confirmed to work,
see Step 4).

## Step 4: GET results page

    GET https://checkpeople.com/landing/people/{searchId}/results?_token=...&aid=11&firstName=...&lastName=...&city=...&state=
    -> 200 OK, text/html (22KB in this synthetic no-match run)
    <title>Search Results for Zaphod Beeblebrox - CheckPeople.com</title>

Response MIME type: text/html (server-rendered, NOT a JSON API — no XHR/fetch
call was found doing the actual result-fetching; the whole page including the
"no results" modal is delivered in the initial server response).

### Result container structure

    <div class="results-container">
      <div class="results-headline">
        <h1 class="results-headline-title">We found 10+ Results for <span>Zaphod Beeblebrox</span></h1>
        <img class="loading-animation" ... alt="Loading Step One">
        <h3 class="animation-subtext"><strong>Preparing to build report, please wait.</strong></h3>
      </div>
      <button class="modify-search" data-target="#modifySearchModal">Modify Search</button>
    </div>

IMPORTANT: the headline claims "We found 10+ Results" even for a synthetic
name with zero real matches — this is a generic marketing headline, NOT a
real result count. Do not parse it as a match-count signal.

### Empty/no-match response shape

For this fully-synthetic identity, no actual result rows/cards were present
anywhere in the page (`class~="result"`, `"card"`, `"profile"`, `"person"` all
absent except container/headline classes above). The real "no results" signal
is a hidden Bootstrap modal, present in the SAME page load (no separate
request):

    <div class="modal ... gc1b-refine-search-modal" id="modifySearchModal">
      <h4 class="modal-title">No results found. Please refine your search</h4>
      <div class="modal-header-text-1">Try using their maiden name.</div>
      <div class="modal-header-text-2">Add a current or previous city.</div>
      <div class="modal-header-text-3">Expand your search to search All States.</div>
      <form id="modify-search-form" method="GET" action="https://checkpeople.com/landing/people/{searchId}/results">
        <input name=firstName value="zaphod">
        <input name=middleName>
        <input name=lastName value="beeblebrox">
        <input name=city value="Fargo Nd">
        <select name=state>...</select>
      </form>
    </div>

This modal is presumably shown via JS (Bootstrap `data-toggle="modal"`) when
the backend determines there are no real matches; a parser should treat
**presence of `#modifySearchModal` with "No results found"** as the reliable
empty-result signal, not the headline text or result-card absence alone
(cards weren't observed for a positive-match case in this probe — that needs
a follow-up probe with a real/common name if the project ever authorizes it;
this probe deliberately used a fake name only, per task instructions).

No pagination behavior was observed (no results to paginate). No rate
limiting or additional challenge appeared across the 3 requests in this probe
(GET homepage, POST /landing, GET /searching, GET /results — 4 total, within
the "one or two probe" spirit given the /searching redirect was an
unavoidable extra hop).

## Endpoint summary

| Step | Method | URL | Content-Type | Auth |
|---|---|---|---|---|
| 1 | GET | `https://checkpeople.com/` | — | none (sets cookies) |
| 2 | POST | `https://checkpeople.com/landing` | `application/x-www-form-urlencoded` | `_token` (CSRF, from step 1 HTML) + cookies from step 1 |
| 3 | GET | `https://checkpeople.com/landing/people/{searchId}/searching?...` | — | same cookies, same querystring params |
| 4 | GET | `https://checkpeople.com/landing/people/{searchId}/results?...` | — | same cookies, same querystring params |

Required cookies for all steps after 1: `XSRF-TOKEN`, `laravel_session`,
`__cf_bm`, `__uzma`..`__uzme` (Reblaze fingerprinting cookies — present but
did not block the flow in this run).

## Doc staleness note

`docs/FLARESOLVERR.md` (2026-09-09, still on this branch) states CheckPeople
is "still blocked" via an IP-level Cloudflare ban. That was NOT reproduced in
this session or in sibling task t_ec610741/t_0ffa4c8a (both ~12h prior to this
probe) — CheckPeople was fully reachable via plain curl with no solver. Anti-
bot posture appears to fluctuate (possibly IP/time-window dependent per the
doc's own caveat). Recommend: keep `CheckPeopleAdapter.search()` fail-closed
behavior as-is only insofar as it should re-probe live rather than hard-code
"blocked" from a stale doc — the current adapter code
(`packages/core/src/brokers/checkpeople.ts`) already returns `[]` for
search() unconditionally based on THAT stale assumption and should be
revisited by the implementation task, not this recon task.
