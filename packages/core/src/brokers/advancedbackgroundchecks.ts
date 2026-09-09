import type { Page } from "playwright";
import type { BrokerAdapter, RemovalResult } from "./types.js";
import type { PiiProfile } from "../pii.js";

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
   * data. The live route currently returns Cloudflare's anti-bot challenge
   * before results, so this intentionally fails closed with no candidates.
   */
  async search(page: Page, minimalProfile: Partial<PiiProfile>): Promise<import("./matching.js").SearchCandidate[]> {
    const firstName = minimalProfile.firstName?.trim();
    const lastName = minimalProfile.lastName?.trim();
    if (!firstName || !lastName) return [];

    const term = `${firstName}-${lastName}`.replace(/\\s+/g, "-");
    await page.goto(`${this.searchUrl}find/name/${encodeURIComponent(term)}`, {
      waitUntil: "domcontentloaded",
    });

    const bodyText = await page.locator("body").innerText().catch(() => "");
    const title = await page.title().catch(() => "");
    if (/just a moment|challenge|cloudflare/i.test(`${title}\\n${bodyText}`)) {
      return [];
    }

    // No result-card markup was live-verified: do not guess selectors or
    // manufacture candidates from an unverified page structure.
    return [];
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
