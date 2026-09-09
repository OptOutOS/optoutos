import type { Page } from "playwright";
import type { PiiProfile } from "../pii.js";
import type { BrokerAdapter, RemovalResult } from "./types.js";
import type { SearchCandidate } from "./matching.js";
import * as cheerio from "cheerio";

/**
 * Parses US Phone Book's name-search result HTML directly (via cheerio).
 *
 * WHY THIS EXISTS (verified live 2026-09-09, superseding the earlier
 * "search-specific access block, fails closed" note further down): the
 * public home page's Name tab was previously documented as unreachable
 * ("city field disabled until an unidentified interaction; Enter key
 * doesn't submit"). Re-verified live: the Name tab button IS a real,
 * working client-side toggle — a genuine Playwright `.click()` failed here
 * because the tab button sits outside the rendered viewport in a headless
 * context (a real layout/CSS quirk, not a broken control), but dispatching
 * the click via `page.evaluate()` works and correctly enables the city
 * field and switches the hidden `searchType` input to `"person"`. Pressing
 * Enter in the now-enabled name field (not raw `form.submit()`, which hits
 * a dead `/person-search` route) correctly navigates to a real
 * `/{first}-{last}` results page. This was a real search bug in an earlier
 * investigation, not a genuinely dead flow — corrected here.
 *
 * Card structure verified live 2026-09-09 (see
 * src/brokers/__fixtures__/usphonebook-john-smith.html, a real saved page,
 * not fabricated) against https://www.usphonebook.com/john-smith
 * ("249 Public Records Found for John Smith"):
 *   Each result: <div class="success-wrapper-block" itemscope
 *     itemtype="https://schema.org/Person" itemid="https://www.usphonebook.com/{slug}/{id}">
 *     <h3><span itemprop="name">{Name}</span>, Age {N}</h3>
 *     <div>Lives in: <span itemprop="address">{City}, {ST}</span></div>
 *     Prior addresses: <span itemprop="address">{City}, {ST}</span>, ...
 *     Relatives: <a itemprop="relatedTo" itemtype=".../Person">
 *       <span itemprop="name">{Relative Name}</span></a>, ...
 *
 * As with the other cheerio parsers in this project, every card found is
 * returned as-is (including unrelated same-name people) — match filtering
 * is the privacy engine's job (scoreCandidate/runRemoval), never this
 * parser's; it never guesses relevance.
 */
export function parseUsPhonebookResults(html: string): SearchCandidate[] {
  const $ = cheerio.load(html);
  const candidates: SearchCandidate[] = [];

  $(".success-wrapper-block[itemtype='https://schema.org/Person']").each((_, el) => {
    const $card = $(el);
    const candidateId = $card.attr("itemid");
    if (!candidateId) return;

    const $nameSpan = $card.find("h3 [itemprop='name']").first();
    const observedName = $nameSpan.text().trim() || undefined;

    const h3Text = $card.find("h3").first().text();
    const ageMatch = h3Text.match(/,\s*Age\s*(\d+\+?)/i);
    const observedAgeRange = ageMatch ? ageMatch[1] : undefined;

    // "Lives in:" is the current-address block; its first [itemprop=address]
    // is the reliable single city/state pair for this card.
    let observedCity: string | undefined;
    let observedState: string | undefined;
    const livesInBlock = $card
      .find("div")
      .filter((_i, d) => $(d).text().trim().startsWith("Lives in:"))
      .first();
    const cityStateText = livesInBlock.find("[itemprop='address']").first().text().trim();
    const cityStateMatch = cityStateText.match(/^(.+?),\s*([A-Z]{2})$/);
    if (cityStateMatch) {
      observedCity = cityStateMatch[1].trim();
      observedState = cityStateMatch[2].trim();
    }

    // Relatives are marked with itemprop="relatedTo" directly on their own
    // <a itemscope itemtype=".../Person"> nodes — distinct nested Person
    // microdata, not siblings-of-a-label like other brokers, so there is no
    // self-inclusion risk the way there was for Spokeo.
    const observedRelatives: string[] = [];
    $card.find("[itemprop='relatedTo'] [itemprop='name']").each((_i, relEl) => {
      const name = $(relEl).text().trim();
      if (name) observedRelatives.push(name);
    });

    candidates.push({
      candidateId,
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
 * US Phone Book opt-out adapter.
 *
 * Verified against https://usphonebook.com/opt-out on 2026-09-09. The page
 * combines the initial record-removal request with the opt-out instructions:
 * the requester enters the subject's first name, optional middle name, last
 * name, and email, chooses whether they are the subject or an authorized
 * agent, accepts the certification, completes reCAPTCHA, and selects
 * "Begin Removal Process". US Phone Book then emails a link to a second form;
 * this page does not submit the final removal request directly.
 *
 * The live rendered page exposed these labels/text: "Subject First Name*",
 * "Subject Middle Name", "Subject Last Name*", "Subject Email*",
 * "Begin Removal Process", and "reCAPTCHA". The live page also displayed
 * "Recaptcha requires verification" and "This site is exceeding reCAPTCHA
 * Enterprise free quota". Because this is an active CAPTCHA gate, the
 * adapter fails closed with requires_manual_verification and never attempts
 * to solve or bypass it.
 *
 * No API or email endpoint was exposed by the verified page, so METHOD_PRIORITY
 * selects the web form. requiredFields contains only the subject identity and
 * email needed for the initial request; an agent flow would additionally need
 * agent fields supplied by a future explicit agent-profile API.
 *
 * SEARCH VERIFICATION (re-verified live 2026-09-09, superseding the earlier
 * "search-specific access block, fails closed" finding above): the earlier
 * investigation found the Name tab's city field disabled and Enter not
 * submitting, and concluded the flow was genuinely broken/unreachable. That
 * conclusion was WRONG — re-verified live: `www.usphonebook.com` (not the
 * bare `usphonebook.com` host, which does return HTTP 403) loads fine, the
 * Name tab IS a working client-side toggle (a real Playwright `.click()`
 * fails because the tab sits outside the headless viewport — a layout
 * quirk, not a broken control — but `page.evaluate()`-dispatched click
 * works and correctly enables the city field), and pressing Enter in the
 * now-enabled name field navigates to a real `/{first}-{last}` results page
 * (NOT `form.submit()`, which hits a dead `/person-search` route). See
 * parseUsPhonebookResults() above for the verified real result-card
 * structure (schema.org Person microdata) and its docstring for the full
 * navigation sequence. search() below reproduces this sequence with a live
 * Playwright `page` (unlike the FlareSolverr-raw-fetch pattern used for
 * Advanced Background Checks and Spokeo — this route needs genuine
 * client-side JS interaction, not just a passive Cloudflare challenge, so
 * there is nothing for FlareSolverr to solve here).
 *
 * Submission is intentionally dry-run only: after filling the observed
 * subject fields, it returns requires_manual_verification without clicking the
 * real request button or sending an email.
 */
export class UsPhonebookAdapter implements BrokerAdapter {
  readonly brokerId = "usphonebook";
  readonly brokerName = "US Phone Book";
  readonly method = "form" as const;
  readonly searchUrl = "https://www.usphonebook.com/";
  readonly optOutUrl = "https://usphonebook.com/opt-out";
  readonly requiredFields = ["firstName", "lastName", "emails"] as const;
  readonly searchFields = ["firstName", "lastName"] as const;

  /**
   * Search US Phone Book's name-search flow via a live Playwright page (not
   * FlareSolverr — see the class docstring's SEARCH VERIFICATION note for
   * why this route needs genuine client-side interaction rather than a
   * passive-challenge solve). Fails closed to [] if any step of the
   * verified navigation sequence doesn't behave as expected — never
   * guesses at unverified selectors or a substitute route.
   */
  async search(page: Page, minimalProfile: Partial<PiiProfile>): Promise<SearchCandidate[]> {
    const firstName = minimalProfile.firstName?.trim();
    const lastName = minimalProfile.lastName?.trim();
    if (!firstName || !lastName) return [];

    try {
      // networkidle (not domcontentloaded) is required here — verified live:
      // the name-search autocomplete/submit JS isn't fully attached yet at
      // domcontentloaded, causing Enter to fall through to a dead
      // /search route instead of the real /{first}-{last} results page.
      await page.goto(this.searchUrl, { waitUntil: "networkidle", timeout: 30000 });

      // Real, verified layout quirk: the Name tab button renders outside the
      // headless viewport, so a genuine Playwright .click() times out even
      // though the control works. Dispatch the click via evaluate() instead
      // — this is the verified working path, not a bypass of anything.
      const tabClicked = await page.evaluate(() => {
        const btn = document.querySelector<HTMLButtonElement>(
          '.pf-search-tabs button[data-search-type="name"]',
        );
        if (!btn) return false;
        btn.click();
        return true;
      });
      if (!tabClicked) return [];
      // Small settle delay after the tab toggle, mirroring the verified
      // live sequence — the city field's disabled->enabled DOM update and
      // the tab's own JS state need a moment before the input is reliably
      // interactive.
      await page.waitForTimeout(500);

      const nameInput = page.locator("#pfHeaderInput");
      if ((await nameInput.count()) === 0) return [];

      await nameInput.fill(`${firstName} ${lastName}`);
      await nameInput.press("Enter");
      await page.waitForTimeout(3000);

      const html = await page.content();
      return parseUsPhonebookResults(html);
    } catch {
      // Any navigation/timeout failure fails closed — never guess or retry
      // indefinitely.
      return [];
    }
  }

  async optOut(page: Page, profile: Partial<PiiProfile>): Promise<RemovalResult> {
    const timestamp = new Date().toISOString();
    const email = profile.emails?.[0];

    if (!profile.firstName || !profile.lastName || !email) {
      return this.fail(timestamp, "Missing required first name, last name, or email");
    }

    await page.goto(this.optOutUrl, { waitUntil: "domcontentloaded" });

    // Fail closed on the CAPTCHA observed on the live page. Do not bypass it.
    const captcha = page.locator(
      ".g-recaptcha, [class*=\"g-recaptcha\"], iframe[src*=\"recaptcha\"], [id*=\"recaptcha\"]",
    );
    const renderedCaptchaText = page.getByText(/reCAPTCHA|Recaptcha requires verification|I'm not a robot/i);
    if ((await captcha.count()) > 0 || (await renderedCaptchaText.count()) > 0) {
      return {
        broker: this.brokerId,
        status: "requires_manual_verification",
        timestamp,
        evidence: {
          reason: "reCAPTCHA detected; automation does not attempt to bypass CAPTCHA",
        },
      };
    }

    // These labels were observed in the rendered live page. Fail closed if
    // the page no longer exposes the verified initial-request flow.
    const firstName = page.getByLabel(/Subject\s+First\s+Name/i);
    const lastName = page.getByLabel(/Subject\s+Last\s+Name/i);
    const subjectEmail = page.getByLabel(/Subject\s+Email/i);
    if ((await firstName.count()) === 0 || (await lastName.count()) === 0 || (await subjectEmail.count()) === 0) {
      return this.fail(timestamp, "Form structure changed: verified subject fields not found");
    }

    await firstName.fill(profile.firstName);
    await lastName.fill(profile.lastName);
    await subjectEmail.fill(email);

    // Dry-run only. The real button is deliberately never clicked.
    return {
      broker: this.brokerId,
      status: "requires_manual_verification",
      timestamp,
      evidence: {
        dryRun: true,
        note: "Initial request fields filled but not submitted; complete reCAPTCHA and the emailed second form manually",
      },
    };
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
