import type { Page } from "playwright";
import type { PiiProfile } from "../pii.js";
import type { BrokerAdapter, RemovalResult } from "./types.js";
import type { SearchCandidate } from "./matching.js";

/**
 * CheckPeople adapter.
 *
 * Live verification on 2026-09-09:
 * - DNS resolved checkpeople.com (Cloudflare addresses).
 * - The public search URL https://checkpeople.com/ was not reachable from
 *   this runtime: direct HTTP requests returned HTTP 403, and the rendered
 *   page reported "Verifying Protocol For Anonymous Access..." rather than
 *   exposing a usable search/result flow.
 * - The previously inspected opt-out URL is separately blocked by the same
 *   anti-bot boundary. No result-listing markup or candidate fields were
 *   observed, so this adapter must not guess selectors or candidates.
 *
 * search() deliberately returns [] after recording the verified blocked state.
 * It never attempts to bypass Cloudflare or submit opt-out data blindly.
 */
export class CheckPeopleAdapter implements BrokerAdapter {
  readonly brokerId = "checkpeople";
  readonly brokerName = "CheckPeople";
  readonly method = "form" as const;
  readonly searchUrl = "https://checkpeople.com/";
  readonly optOutUrl = "https://checkpeople.com/opt-out";
  readonly searchFields = ["firstName", "lastName", "addresses"] as const;
  readonly requiredFields = ["emails", "firstName", "lastName", "addresses"] as const;

  async search(_page: Page, _minimalProfile: Partial<PiiProfile>): Promise<SearchCandidate[]> {
    // Live probe was HTTP 403 / anonymous-access verification; fail closed.
    return [];
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
