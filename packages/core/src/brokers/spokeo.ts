import type { Page } from "playwright";
import type { PiiProfile } from "../pii.js";
import type { BrokerAdapter, RemovalResult } from "./types.js";
import type { SearchCandidate } from "./matching.js";
import { getFlareSolverrClientFromEnv } from "../flaresolverr.js";
import { hasAntiBotMarkerOnPage } from "./detection.js";
import * as cheerio from "cheerio";

/**
 * Parses Spokeo's search-result HTML directly (via cheerio), mirroring the
 * FlareSolverr-raw-HTML-fetch pattern proven for Advanced Background Checks:
 * fetch the rendered page HTML through FlareSolverr's own solve API and
 * parse it, rather than trying to reach the live page a second time with
 * Playwright (direct Playwright navigation to spokeo.com returns a flat
 * HTTP 403 for this project's runtime — verified live 2026-09-09; the
 * FlareSolverr fetch of the same URL cleared cleanly with "Challenge not
 * detected!" and returned a real, populated results page).
 *
 * Card structure verified live 2026-09-09 (see
 * src/brokers/__fixtures__/spokeo-john-smith.html, a real saved page, not
 * fabricated) against https://www.spokeo.com/John-Smith:
 *   Each result: <div role="listitem"> ... <h3><a href="/John-Smith/{State}/{City}/{id}">
 *     {Name}, Age {N}</a></h3>
 *   <span>Locations:</span> {comma-separated "City ST" list}
 *   <span>Relatives:</span> <a href="/{Slug}">{Relative Name}</a>, ...
 *
 * As with the ABC parser, this returns every listitem found — including
 * unrelated same-name people — and leaves match filtering to the privacy
 * engine's scoreCandidate()/runRemoval(), never guessing relevance here.
 */
export function parseSpokeoResults(html: string): SearchCandidate[] {
  const $ = cheerio.load(html);
  const candidates: SearchCandidate[] = [];

  $('#name-search-results-list [role="listitem"]').each((_, el) => {
    const $item = $(el);
    const $link = $item.find('h3 a[href^="/"]').first();
    const href = $link.attr("href");
    if (!href) return;

    const linkText = $link.text().trim(); // e.g. "John L Smith, Age 69" or "...Age 69 (Deceased)"
    const ageMatch = linkText.match(/,\s*Age\s*(\d+\+?)/i);
    const observedAgeRange = ageMatch ? ageMatch[1] : undefined;
    const observedName = ageMatch ? linkText.slice(0, ageMatch.index).trim() : linkText || undefined;

    // "Resided in {City}, {ST}" / "Resides in {City}, {ST}" heading, when
    // present, is the most reliable single city/state pair for this listing
    // (Spokeo uses either wording depending on whether the person is
    // deceased — verified live in the fixture: "Resided in" for a Deceased
    // entry, "Resides in" for a living one).
    let observedCity: string | undefined;
    let observedState: string | undefined;
    const residedText = $item.find(".display-1").first().text().trim();
    const residedMatch = residedText.match(/Resid(?:ed|es)\s+in\s+(.+?),\s*([A-Z]{2})$/i);
    if (residedMatch) {
      observedCity = residedMatch[1].trim();
      observedState = residedMatch[2].trim();
    } else {
      // Fall back to the state/city segments embedded in the profile URL,
      // e.g. /John-Smith/Oklahoma/Lexington/p10004569131.
      const urlParts = href.split("/").filter(Boolean);
      if (urlParts.length >= 3) {
        observedState = urlParts[1].replace(/-/g, " ");
        observedCity = urlParts[2].replace(/-/g, " ");
      }
    }

    // Relatives are listed as `<span>Relatives:</span> <a>Name</a>, <a>Name</a>, ...`
    // as SIBLINGS of the label span, not children of a shared wrapper (the
    // listitem's wrapper also contains the person's own name link in <h3>,
    // so naively searching the whole item/parent for <a> tags would
    // wrongly include the candidate's own name as a "relative" — verified
    // against the real fixture, where this produced exactly that bug).
    const observedRelatives: string[] = [];
    $item
      .find("span:contains('Relatives:')")
      .first()
      .nextUntil("span.copy-2, div")
      .filter("a")
      .each((_i, relEl) => {
        const name = $(relEl).text().trim();
        if (name) observedRelatives.push(name);
      });

    candidates.push({
      candidateId: href,
      observedName,
      observedCity,
      observedState,
      observedAgeRange,
      observedRelatives: observedRelatives.length > 0 ? observedRelatives : undefined,
    });
  });

  return candidates;
}

/**
 * Spokeo opt-out adapter.
 *
 * Live verification performed 2026-09-09 against:
 *   - https://spokeo.com/search
 *   - https://spokeo.com/optout
 *
 * The rendered opt-out page states that each listing has a unique profile URL,
 * which must be submitted individually, and asks for that URL plus an email
 * address; Spokeo sends a confirmation email. It also documents the payment
 * URL form of listing URL and identifies privacy@spokeo.com as a contact.
 * Submission is intentionally dry-run only, and this adapter still does not
 * guess/submit an opt-out request — see optOut() below.
 *
 * SEARCH STATUS (re-verified live 2026-09-09, superseding the earlier
 * "always fails closed" note above): direct Playwright navigation to
 * spokeo.com still returns a flat HTTP 403 in this project's runtime, but a
 * FlareSolverr raw-fetch of a name-search URL
 * (https://www.spokeo.com/{First}-{Last}) cleared cleanly — FlareSolverr
 * itself reported "Challenge not detected!" and returned a real, populated
 * results page (a real captured example, 70,726 matches for "John Smith",
 * is saved at src/brokers/__fixtures__/spokeo-john-smith.html). This mirrors
 * the pattern already proven for Advanced Background Checks: fetch via
 * FlareSolverr's own API and parse with cheerio (parseSpokeoResults above),
 * rather than trying a second live Playwright navigation to the same URL.
 * If FLARESOLVERR_URL is not configured, or the fetch still reports a
 * challenge/error, search() fails closed to [] — it never guesses.
 */
export class SpokeoAdapter implements BrokerAdapter {
  readonly brokerId = "spokeo";
  readonly brokerName = "Spokeo";
  readonly method = "form" as const;
  readonly searchUrl = "https://www.spokeo.com";
  readonly optOutUrl = "https://spokeo.com/optout";
  readonly requiredFields = ["emails"] as const;
  readonly searchFields = ["firstName", "lastName"] as const;

  /**
   * Search Spokeo's public name-search route via FlareSolverr's raw-HTML
   * fetch, mirroring AdvancedBackgroundChecksAdapter.search() (see that
   * adapter's docstring for why this bypasses `page` entirely for this
   * route). `page` is accepted (required by BrokerAdapter) but unused here;
   * optOut() still uses `page` normally for the /optout route.
   */
  async search(_page: Page, minimalProfile: Partial<PiiProfile>): Promise<SearchCandidate[]> {
    const firstName = minimalProfile.firstName?.trim();
    const lastName = minimalProfile.lastName?.trim();
    if (!firstName || !lastName) return [];

    const flareSolverr = getFlareSolverrClientFromEnv();
    if (!flareSolverr) return [];

    const slug = `${firstName}-${lastName}`.replace(/\s+/g, "-");
    const targetUrl = `${this.searchUrl}/${encodeURIComponent(slug)}`;

    try {
      const solution = await flareSolverr.solve(targetUrl);
      return parseSpokeoResults(solution.response);
    } catch {
      // FlareSolverr unavailable, timed out, or still challenged — fail
      // closed rather than guess or retry indefinitely.
      return [];
    }
  }

  async optOut(page: Page, profile: Partial<PiiProfile>): Promise<RemovalResult> {
    const timestamp = new Date().toISOString();
    const email = profile.emails?.[0];
    if (!email) return this.fail(timestamp, "Missing required email");

    await page.goto(this.optOutUrl, { waitUntil: "domcontentloaded" });

    if (await hasAntiBotMarkerOnPage(page)) {
      return {
        broker: this.brokerId,
        status: "requires_manual_verification",
        timestamp,
        evidence: {
          reason: "Anti-bot challenge detected; automation intentionally does not bypass it",
        },
      };
    }

    // The live page requires a listing URL, but PiiProfile has no listing URL
    // field. Fail closed rather than inventing a selector or submitting a
    // guessed record. The email is deliberately not entered without that URL.
    return {
      broker: this.brokerId,
      status: "requires_manual_verification",
      timestamp,
      evidence: {
        dryRun: true,
        note: "Spokeo requires a verified listing URL and confirmation email; no listing URL is available in PiiProfile",
      },
    };
  }

  private fail(timestamp: string, error: string): RemovalResult {
    return { broker: this.brokerId, status: "failed", timestamp, evidence: {}, error };
  }
}
