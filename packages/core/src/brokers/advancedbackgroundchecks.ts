import type { Page } from "playwright";
import type { BrokerAdapter, RemovalResult } from "./types.js";
import type { PiiProfile } from "../pii.js";
import { getFlareSolverrClientFromEnv } from "../flaresolverr.js";
import * as cheerio from "cheerio";
import type { SearchCandidate } from "./matching.js";

/**
 * Parses Advanced Background Checks' search-result HTML directly (via
 * cheerio), rather than relying on Playwright to reach the live page.
 *
 * WHY: verified live 2026-09-09 that FlareSolverr's cookie-injection pattern
 * (which works for the /opt-out route) does NOT reliably clear the
 * /find/name/{term} route for a fresh Playwright context — the page still
 * showed "Just a moment..." even after FlareSolverr solved that exact URL
 * directly via its own API (confirmed: 320KB+ real results returned by
 * FlareSolverr itself). So: parse FlareSolverr's raw HTML response directly,
 * never attempt a second live Playwright navigation to this route.
 *
 * Card structure verified live 2026-09-09 (see
 * src/brokers/__fixtures__/advancedbackgroundchecks-search-results.html, a
 * real saved excerpt, not fabricated):
 *   Each result: <a class="group" href="/find/person/{slug}">
 *     <h2>{Name}<span>Age {N}</span></h2></a>
 *   <p class="text-sm mt-1"><a href="/people/{state}/{city}">{City}, {State}</a>
 *     <a href="/people/zip/{zip}">{zip}</a></p>
 *   Optional "Used to live:" section with prior address links.
 *
 * The page also lists many OTHER unrelated people (related/associated
 * records) alongside genuine name matches — candidates are returned as-is
 * for every person block found; the privacy-minimization engine
 * (scoreCandidate/runRemoval) is responsible for filtering to a real match,
 * NOT this parser. This parser's only job is faithful extraction of what
 * the broker displayed, never guessing or filtering by "relevance".
 */
export function parseAdvancedBackgroundChecksResults(html: string): SearchCandidate[] {
  const $ = cheerio.load(html);
  const candidates: SearchCandidate[] = [];

  $('a.group[href^="/find/person/"]').each((_, el) => {
    const $link = $(el);
    const href = $link.attr("href");
    if (!href) return;

    const $h2 = $link.find("h2").first();
    const ageText = $h2.find("span").first().text().trim();
    const ageMatch = ageText.match(/Age\s*(\d+)/i);
    const observedAgeRange = ageMatch ? ageMatch[1] : undefined;

    // Name is the h2's text with the age span's text removed.
    const fullH2Text = $h2.text().trim();
    const observedName = ageMatch ? fullH2Text.replace(ageText, "").trim() : fullH2Text;

    // The current-location paragraph is the next sibling <p> in the same
    // wrapping block as the name link.
    const $container = $link.closest("div");
    const $locationP = $container.find("p.text-sm").first();
    const locationLinks = $locationP.find("a");
    let observedCity: string | undefined;
    let observedState: string | undefined;
    let observedZip: string | undefined;

    if (locationLinks.length > 0) {
      const cityStateText = $(locationLinks[0]).text().trim(); // e.g. "Port Orchard, WA" (with comment nodes stripped by cheerio)
      const cityStateMatch = cityStateText.match(/^(.+?),\s*([A-Z]{2})$/);
      if (cityStateMatch) {
        observedCity = cityStateMatch[1].trim();
        observedState = cityStateMatch[2].trim();
      }
      if (locationLinks.length > 1) {
        observedZip = $(locationLinks[1]).text().trim();
      }
    }

    const extra: Record<string, string> = {};
    const usedToLiveLabel = $container.find("span:contains('Used to live')").first();
    if (usedToLiveLabel.length) {
      const usedToLiveText = usedToLiveLabel.parent().text().replace("Used to live:", "").trim();
      if (usedToLiveText) {
        extra.usedToLive = usedToLiveText;
      }
    }

    candidates.push({
      candidateId: href,
      observedName: observedName || undefined,
      observedCity,
      observedState,
      observedZip,
      observedAgeRange,
      extra: Object.keys(extra).length > 0 ? extra : undefined,
    });
  });

  return candidates;
}

/**
 * AdvancedBackgroundChecks opt-out adapter.
 *
 * Verified against the live opt-out page at
 * https://www.advancedbackgroundchecks.com/opt-out on 2026-09-09 via direct
 * HTTP DOM inspection. The first step is a direct request form (not a
 * search-then-remove flow): it asks for the request subject/agent selection,
 * first name, optional middle name, last name, and email, then emails a link
 * to continue the opt-out process.
 *
 * Verified form controls:
 *   #mode   (select)        — subject of request / authorized agent
 *   #sfn    (text, required) — first name
 *   #smn    (text)           — middle name
 *   #sln    (text, required) — last name
 *   #semail (email, required) — email address
 *   submit button type="submit"
 *
 * ANTI-BOT STATUS (verified 2026-09-09): the rendered page explicitly states
 * that it is protected by reCAPTCHA, and the HTML contains the reCAPTCHA
 * marker. Per project policy, this adapter detects the challenge and fails
 * closed with "requires_manual_verification"; it does not attempt to solve or
 * bypass CAPTCHA. The final submit is also intentionally disabled in this
 * adapter's dry-run path.
 *
 * No public opt-out API was found in the page or robots.txt checks. The method
 * is therefore the web form, preferred over email by METHOD_PRIORITY. Because
 * the initial form only requests name and email, requiredFields contains only
 * those PII fields. A user must complete the emailed continuation link
 * manually after this adapter returns.
 *
 * SEARCH STATUS (verified 2026-09-09): the public home page exposes a Name
 * form with observed controls aria-label="First name", aria-label="Last name",
 * aria-label="City", and aria-label="State"; its name-search action leads to
 * /find/name/{term}. A live request to that action is stopped by Cloudflare's
 * "Just a moment..." challenge before any broker result cards are rendered.
 * No result-card DOM was therefore observed or used here. search() detects the
 * challenge and returns [] (fail closed); it never treats a challenge page as
 * a candidate and never guesses selectors for result cards. This adapter cannot
 * currently provide an automatable, live-verified public search until the broker
 * permits the request or its result markup can be inspected without bypassing
 * anti-bot protection.
 */
export class AdvancedBackgroundChecksAdapter implements BrokerAdapter {
  readonly brokerId = "advancedbackgroundchecks";
  readonly brokerName = "Advanced Background Checks";
  readonly method = "form" as const;
  readonly searchUrl = "https://advancedbackgroundchecks.com/";
  readonly optOutUrl = "https://www.advancedbackgroundchecks.com/opt-out";
  readonly requiredFields = ["firstName", "lastName", "emails"] as const;
  readonly searchFields = ["firstName", "lastName"] as const;

  /**
   * Search the broker's public name-search route without submitting opt-out
   * data.
   *
   * IMPORTANT (verified 2026-09-09, see parseAdvancedBackgroundChecksResults
   * docstring above): this route's Cloudflare challenge does NOT reliably
   * clear via Playwright + injected FlareSolverr cookies, even though
   * FlareSolverr itself solves the same URL correctly via its own API. So
   * this method calls FlareSolverr directly for the HTML and parses it with
   * cheerio — it does NOT navigate `page` to this URL at all. `page` is
   * still accepted (required by the BrokerAdapter interface) but unused
   * here; optOut() still uses `page` normally for the /opt-out route, which
   * IS reliably reachable via the Playwright+cookie-injection pattern.
   *
   * If FLARESOLVERR_URL is not configured, or FlareSolverr fails/still
   * reports a challenge page, this fails closed to [] — never guesses.
   */
  async search(_page: Page, minimalProfile: Partial<PiiProfile>): Promise<SearchCandidate[]> {
    const firstName = minimalProfile.firstName?.trim();
    const lastName = minimalProfile.lastName?.trim();
    if (!firstName || !lastName) return [];

    const flareSolverr = getFlareSolverrClientFromEnv();
    if (!flareSolverr) return [];

    const term = `${firstName}-${lastName}`.replace(/\s+/g, "-");
    const targetUrl = `${this.searchUrl}find/name/${encodeURIComponent(term)}`;

    try {
      const solution = await flareSolverr.solve(targetUrl);
      return parseAdvancedBackgroundChecksResults(solution.response);
    } catch {
      // FlareSolverr unavailable, timed out, or still challenged — fail
      // closed rather than guess or retry indefinitely.
      return [];
    }
  }

  async optOut(page: Page, profile: Partial<PiiProfile>): Promise<RemovalResult> {
    const timestamp = new Date().toISOString();

    if (!profile.firstName || !profile.lastName) {
      return this.fail(timestamp, "Missing required name fields");
    }
    const email = profile.emails?.[0];
    if (!email) {
      return this.fail(timestamp, "Missing required email");
    }

    await page.goto(this.optOutUrl, { waitUntil: "domcontentloaded" });

    // Detect, but never bypass, an interactive CAPTCHA/anti-bot challenge.
    const recaptchaMarker = page.locator(
      ".g-recaptcha, [class*='recaptcha'], [id*='recaptcha'], " +
        "iframe[src*='recaptcha'], [data-sitekey]",
    );
    const bodyMentionsRecaptcha = /reCAPTCHA|hCaptcha|Turnstile|captcha/i.test(
      await page.locator("body").innerText().catch(() => ""),
    );
    if ((await recaptchaMarker.count()) > 0 || bodyMentionsRecaptcha) {
      return {
        broker: this.brokerId,
        status: "requires_manual_verification",
        timestamp,
        evidence: {
          reason: "reCAPTCHA/anti-bot protection detected — automation intentionally does not attempt to bypass CAPTCHA",
        },
      };
    }

    // Fail closed if the verified form structure changes.
    if ((await page.locator("#sfn").count()) === 0 || (await page.locator("#sln").count()) === 0) {
      return this.fail(
        timestamp,
        "Form structure changed: verified name fields not found — adapter needs re-verification",
      );
    }

    await page.locator("#sfn").fill(profile.firstName);
    if (profile.middleName) {
      await page.locator("#smn").fill(profile.middleName);
    }
    await page.locator("#sln").fill(profile.lastName);
    await page.locator("#semail").fill(email);

    // Dry-run only: do not send an opt-out request or trigger the email flow.
    const dryRun = true;
    if (dryRun) {
      return {
        broker: this.brokerId,
        status: "requires_manual_verification",
        timestamp,
        evidence: {
          dryRun: true,
          note: "Verified initial form filled but not submitted; user must complete emailed continuation and CAPTCHA manually",
        },
      };
    }

    return this.fail(timestamp, "Unreachable: dry-run is required for this adapter");
  }

  private fail(timestamp: string, error: string): RemovalResult {
    return {
      broker: this.brokerId,
      status: "failed",
      timestamp,
      evidence: {},
      error,
    };
  }
}
