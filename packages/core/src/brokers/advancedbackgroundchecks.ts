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
 */
export class AdvancedBackgroundChecksAdapter implements BrokerAdapter {
  readonly brokerId = "advancedbackgroundchecks";
  readonly brokerName = "Advanced Background Checks";
  readonly method = "form" as const;
  readonly searchUrl = "https://advancedbackgroundchecks.com/";
  readonly optOutUrl = "https://www.advancedbackgroundchecks.com/opt-out";
  readonly requiredFields = ["firstName", "lastName", "emails"] as const;

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
