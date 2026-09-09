import type { Page } from "playwright";
import type { PiiProfile } from "../pii.js";
import type { BrokerAdapter, RemovalResult } from "./types.js";

/**
 * CheckPeople opt-out adapter.
 *
 * Live verification on 2026-09-09:
 *   - DNS for checkpeople.com resolved successfully.
 *   - The requested data-rights page links its opt-out action to
 *     https://checkpeople.com/opt-out.
 *   - The accessible page content for /opt-out currently presents an email
 *     address gate and a Continue action. It does not expose the older
 *     "Remove Record" search flow in the content available to this runtime.
 *   - Direct HTTP access to the requested page was blocked by Cloudflare with
 *     HTTP 403, so field selectors and the post-email record-removal flow
 *     could not be verified in a real interactive browser session.
 *
 * This adapter therefore fails closed rather than guessing selectors or
 * submitting a request. It detects common interactive anti-bot widgets before
 * returning the unverified-structure failure. No public API was found during
 * the API-first lookup; the supported route observed is the web flow.
 *
 * Required data is limited to the email address shown by the currently
 * accessible opt-out gate. The adapter is intentionally dry-run-only.
 */
export class CheckPeopleAdapter implements BrokerAdapter {
  readonly brokerId = "checkpeople";
  readonly brokerName = "CheckPeople";
  readonly method = "form" as const;
  readonly searchUrl = "https://checkpeople.com/";
  readonly optOutUrl = "https://checkpeople.com/opt-out";
  readonly requiredFields = ["emails"] as const;

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

    // The live interactive selectors could not be verified because the site
    // returned Cloudflare HTTP 403 to this runtime. Do not guess or submit.
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
