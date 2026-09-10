import type { Page } from "playwright";
import type { PiiProfile } from "../pii.js";
import type { BrokerAdapter, RemovalResult } from "./types.js";
import type { SearchCandidate } from "./matching.js";
import * as cheerio from "cheerio";

/**
 * Detects CheckPeople's real "no match" signal on a results page.
 *
 * WHY THIS EXISTS (verified live 2026-09-10, see
 * docs/checkpeople-reachability.md for the full navigation sequence): the
 * results page ALWAYS renders a generic "We found 10+ Results for {name}"
 * marketing headline, even for a synthetic identity with zero real
 * matches — that headline text must never be treated as a match-count
 * signal. The real "no results" indicator is a hidden Bootstrap modal
 * present in the SAME page load:
 *   <div class="modal ... " id="modifySearchModal">
 *     <h4 class="modal-title">No results found. Please refine your search</h4>
 *   ...
 * This function returns true only when that modal's "No results found"
 * text is present. It does not attempt to parse individual result cards —
 * a positive-match page's card structure has not yet been observed live
 * (this project's verification policy deliberately never probes with a
 * real person's name), so no result-row parser exists here yet; only the
 * empty-result signal is safe to rely on today.
 */
export function checkPeopleHasNoMatch(html: string): boolean {
  const $ = cheerio.load(html);
  const modalText = $("#modifySearchModal .modal-title").first().text();
  return /no results found/i.test(modalText);
}

/**
 * CheckPeople adapter.
 *
 * REACHABILITY (re-verified live 2026-09-10, superseding the 2026-09-09
 * "IP-banned" finding below): a full synthetic search flow (homepage ->
 * scrape Laravel CSRF _token -> POST /landing -> GET .../results, skipping
 * the transient .../searching redirect hop) completed cleanly via plain
 * HTTP requests with zero anti-bot challenges, reproduced independently
 * twice on 2026-09-10. See docs/checkpeople-reachability.md for the full
 * endpoint spec and captured cookies.
 *
 * HOWEVER, the posture is genuinely inconsistent, not simply "now open":
 * an independent re-check roughly an hour later hit a Cloudflare
 * "Under Attack Mode"-style JS-challenge redirect on the same homepage.
 * search() below re-probes live on every call rather than assuming either
 * extreme — it does not cache or hard-code a reachability verdict.
 *
 * Earlier finding (2026-09-09, now known to be non-representative of a
 * fixed state): the public search URL https://checkpeople.com/ was not
 * reachable from this runtime at that time — direct HTTP requests
 * returned HTTP 403, and the rendered page reported "Verifying Protocol
 * For Anonymous Access..." rather than exposing a usable search/result
 * flow. The previously inspected opt-out URL was separately blocked by
 * the same anti-bot boundary at that time.
 *
 * search() uses plain HTTP requests (no Playwright, no FlareSolverr) to
 * reproduce the verified flow: GET homepage for a fresh per-session CSRF
 * token and cookies, POST /landing with the synthetic query, then GET the
 * results page directly using the searchId from the POST's redirect
 * Location header (skipping the intermediate "searching" hop, which is a
 * transient status redirect with no content — verified live). If any step
 * doesn't behave as verified, or the CheckPeopleHasNoMatch signal can't be
 * read, this fails closed to [] — it never guesses at result rows, since
 * no positive-match card structure has been observed live yet.
 */
export class CheckPeopleAdapter implements BrokerAdapter {
  readonly brokerId = "checkpeople";
  readonly brokerName = "CheckPeople";
  readonly method = "form" as const;
  readonly searchUrl = "https://checkpeople.com/";
  readonly optOutUrl = "https://checkpeople.com/opt-out";
  readonly searchFields = ["firstName", "lastName", "addresses"] as const;
  readonly requiredFields = ["emails", "firstName", "lastName", "addresses"] as const;

  async search(_page: Page, minimalProfile: Partial<PiiProfile>): Promise<SearchCandidate[]> {
    const firstName = minimalProfile.firstName?.trim();
    const lastName = minimalProfile.lastName?.trim();
    if (!firstName || !lastName) return [];

    const city = minimalProfile.addresses?.[0]?.city;

    try {
      // Step 1: GET homepage for a fresh per-session CSRF token + cookies.
      const homeRes = await fetch(this.searchUrl, {
        headers: { "User-Agent": USER_AGENT },
      });
      if (!homeRes.ok) return [];
      const cookies = extractSetCookies(homeRes);
      const homeHtml = await homeRes.text();
      const token = extractCsrfToken(homeHtml);
      if (!token || !cookies) return [];

      // Step 2: POST the synthetic-minimal search. Only name (+ city, if
      // known) is sent — never more of the profile than the broker's own
      // search form requires.
      const body = new URLSearchParams({
        _token: token,
        aid: "11",
        firstName,
        lastName,
        ...(city ? { city } : {}),
      });
      const landingRes = await fetch("https://checkpeople.com/landing", {
        method: "POST",
        redirect: "manual",
        headers: {
          "User-Agent": USER_AGENT,
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: this.searchUrl,
          Cookie: cookies,
        },
        body: body.toString(),
      });
      const location = landingRes.headers.get("location");
      if (!location) return [];

      // Step 3: the Location header's searchId is valid for the results
      // page directly — skip the transient "searching" redirect hop
      // (verified live: it 302s again with no content of its own).
      const resultsUrl = location.replace("/searching", "/results");
      const resultsRes = await fetch(resultsUrl, {
        headers: { "User-Agent": USER_AGENT, Cookie: cookies },
      });
      if (!resultsRes.ok) return [];
      const resultsHtml = await resultsRes.text();

      // No positive-match card parser exists yet (never observed live —
      // see class docstring). Only the verified no-match signal is safe
      // to act on; any other shape fails closed rather than guessing.
      if (checkPeopleHasNoMatch(resultsHtml)) return [];
      return [];
    } catch {
      return [];
    }
  }

  async optOut(page: Page, profile: Partial<PiiProfile>): Promise<RemovalResult> {
    const timestamp = new Date().toISOString();
    const email = profile.emails?.[0];
    if (!email) return this.fail(timestamp, "Missing required email");

    await page.goto(this.optOutUrl, { waitUntil: "domcontentloaded" });

    const challenge = page.locator(
      ".cf-turnstile, #cf-turnstile, [class*='cf-chl-widget'], .g-recaptcha, [data-sitekey], .h-captcha",
    );
    if (await challenge.count()) {
      return {
        broker: this.brokerId,
        status: "requires_manual_verification",
        timestamp,
        evidence: {
          reason: "Interactive anti-bot challenge detected; automation does not bypass CAPTCHA/Turnstile",
        },
      };
    }

    return this.fail(
      timestamp,
      "CheckPeople opt-out form structure could not be live-verified; refusing to guess selectors or submit",
    );
  }

  private fail(timestamp: string, error: string): RemovalResult {
    return {
      broker: this.brokerId,
      status: "failed",
      timestamp,
      evidence: { dryRun: true },
      error,
    };
  }
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

function extractCsrfToken(html: string): string | undefined {
  const match = html.match(/name=_token value="([^"]+)"/);
  return match?.[1];
}

function extractSetCookies(res: Response): string | undefined {
  const raw = res.headers.get("set-cookie");
  if (!raw) return undefined;
  // Only the name=value pairs are needed for the next request; drop
  // attributes (Expires, Path, HttpOnly, etc).
  return raw
    .split(/,(?=[^;]+?=)/)
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}
