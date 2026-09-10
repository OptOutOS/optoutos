import type { Page } from "playwright";
import type { PiiProfile } from "../pii.js";
import type { BrokerAdapter, RemovalResult } from "./types.js";
import { hasAntiBotMarkerOnPage } from "./detection.js";

/**
 * Whitepages opt-out adapter.
 *
 * Live verification performed 2026-09-09 against
 * https://whitepages.com/ and https://whitepages.com/suppression_requests
 * using both plain Playwright and playwright-extra with the stealth plugin.
 * The public search navigation was blocked before a search form or results
 * could be reached: requests were redirected to www.whitepages.com and
 * returned HTTP 403 with the Cloudflare page title "Attention Required! |
 * Cloudflare" and rendered text "Sorry, you have been blocked" / "You are
 * unable to access whitepages.com". No search form, result card, candidate
 * fields, or listing URL could therefore be verified with dummy John Smith /
 * Seattle, WA data. The response exposed a Cloudflare footer control with id
 * #cf-footer-ip-reveal, but no Turnstile, hCaptcha, or reCAPTCHA marker was
 * present in the rendered HTML.
 *
 * Per the anti-bot policy, this adapter does not bypass Cloudflare or submit
 * an unverified request. It fails closed with requires_manual_verification
 * when the block/challenge is observed, and with failed if the page changes
 * without presenting a previously verified form. requiredFields is empty
 * because no PII requirements were safely verifiable under the live block.
 *
 * Submission is intentionally dry-run only: even if the block is removed,
 * this spike adapter never clicks a submit control until a real form is
 * re-verified and the implementation is explicitly changed.
 */
export class WhitepagesAdapter implements BrokerAdapter {
  readonly brokerId = "whitepages";
  readonly brokerName = "Whitepages";
  readonly method = "form" as const;
  readonly searchUrl = "https://whitepages.com/";
  readonly optOutUrl = "https://whitepages.com/suppression_requests";
  readonly requiredFields = [] as const;
  readonly searchFields = ["firstName", "lastName", "addresses"] as const;

  /**
   * Search is fail-closed because the live public search was blocked by
   * Cloudflare HTTP 403 before any form or result selectors were available.
   */
  async search(page: Page, _profile: Partial<PiiProfile>): Promise<import("./matching.js").SearchCandidate[]> {
    await page.goto(this.searchUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
    return [];
  }

  async optOut(page: Page, _profile: Partial<PiiProfile>): Promise<RemovalResult> {
    const timestamp = new Date().toISOString();
    await page.goto(this.optOutUrl, { waitUntil: "domcontentloaded" });

    const title = await page.title();
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const cloudflareBlocked =
      /cloudflare/i.test(title) ||
      /sorry, you have been blocked|unable to access whitepages\.com/i.test(bodyText);
    const hasAntiBotMarker = await hasAntiBotMarkerOnPage(page);

    if (cloudflareBlocked || hasAntiBotMarker) {
      return {
        broker: this.brokerId,
        status: "requires_manual_verification",
        timestamp,
        evidence: {
          reason: cloudflareBlocked
            ? "Cloudflare access block detected; automation does not bypass anti-bot protection"
            : "Anti-bot widget detected; automation does not bypass CAPTCHA/Turnstile",
          httpStatus: 403,
        },
      };
    }

    return {
      broker: this.brokerId,
      status: "failed",
      timestamp,
      evidence: {},
      error: "Opt-out form structure was not verified; adapter fails closed rather than guessing selectors",
    };
  }
}
