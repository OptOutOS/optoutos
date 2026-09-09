import type { Page } from "playwright";
import type { PiiProfile } from "../pii.js";
import type { BrokerAdapter, RemovalResult } from "./types.js";

/**
 * BeenVerified opt-out adapter.
 *
 * LIVE VERIFICATION (2026-09-09): DNS for beenverified.com resolved to
 * 104.16.45.7/104.16.44.7 and Cloudflare IPv6 addresses. Both requested URLs
 * loaded successfully over HTTPS but redirected to
 * https://www.beenverified.com/rf/ (HTTP 200, title "Search - BeenVerified").
 * The returned application shell explicitly exposed HCAPTCHA_SITE_KEY and
 * TURNSTILE_SITE_KEY environment values. The requested opt-out routes did not
 * expose a directly inspectable server-rendered form; JavaScript renders the
 * application after load. No public opt-out API was identified in the loaded
 * application shell or the inspected bundle.
 *
 * ANTI-BOT STATUS (verified 2026-09-09): Because the live application
 * advertises hCaptcha and Cloudflare Turnstile, this adapter detects active
 * challenge markers in the rendered HTML and fails closed with
 * "requires_manual_verification". It never attempts to solve or bypass a
 * challenge. Since BeenVerified requires searching for a matching listing
 * before opting out, search() is implemented as the first step. A listing URL
 * and form field selectors could not be verified without passing the site's
 * anti-bot/application gate, so the adapter deliberately does not guess them.
 *
 * Required fields are the minimum identity data needed to begin the documented
 * name/address search flow. No final submission is automated: this adapter is
 * dry-run-only and returns before clicking any submit control.
 */
export class BeenVerifiedAdapter implements BrokerAdapter {
  readonly brokerId = "beenverified";
  readonly brokerName = "BeenVerified";
  readonly method = "form" as const;
  readonly searchUrl = "https://beenverified.com/app/optout/search";
  readonly optOutUrl = "https://beenverified.com/app/optout/address-search";
  readonly requiredFields = ["firstName", "lastName", "addresses"] as const;

  async search(page: Page, profile: Partial<PiiProfile>): Promise<boolean> {
    const timestamp = new Date().toISOString();
    if (!profile.firstName || !profile.lastName || !profile.addresses?.[0]) return false;

    await page.goto(this.searchUrl, { waitUntil: "domcontentloaded" });
    if (await this.hasAntiBotMarker(page)) return false;

    // The live route renders a client application, but no search controls were
    // safely verifiable. Do not guess selectors or submit identity data.
    void timestamp;
    return false;
  }

  async optOut(page: Page, profile: Partial<PiiProfile>): Promise<RemovalResult> {
    const timestamp = new Date().toISOString();
    if (!profile.firstName || !profile.lastName || !profile.addresses?.[0]) {
      return this.fail(timestamp, "Missing required name or address fields");
    }

    await page.goto(this.optOutUrl, { waitUntil: "domcontentloaded" });
    if (await this.hasAntiBotMarker(page)) {
      return {
        broker: this.brokerId,
        status: "requires_manual_verification",
        timestamp,
        evidence: {
          reason: "BeenVerified hCaptcha/Cloudflare Turnstile challenge markers detected; automation does not bypass anti-bot controls",
          dryRun: true,
        },
      };
    }

    return this.fail(
      timestamp,
      "BeenVerified opt-out form/listing selectors were not safely verifiable; no request submitted",
    );
  }

  private async hasAntiBotMarker(page: Page): Promise<boolean> {
    const html = await page.content();
    return /(?:hcaptcha|cf-turnstile|turnstile|g-recaptcha|recaptcha)/i.test(html);
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
