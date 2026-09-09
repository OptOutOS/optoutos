import type { Page } from "playwright";
import type { PiiProfile } from "../pii.js";
import type { BrokerAdapter, RemovalResult } from "./types.js";
import type { SearchCandidate } from "./matching.js";

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
 * The rendered search page exposes name, phone, address, and email search
 * categories, but no stable listing URL can be derived from a PiiProfile alone.
 * Therefore this adapter does not guess a record or URL.
 *
 * Live search verification with dummy John Smith / Seattle, WA data was
 * blocked: https://spokeo.com/search returned HTTP 403 to the live client.
 * No search form, result card, or broker-observed profile URL was available
 * to verify. The adapter therefore fails closed by returning an empty result;
 * it never bypasses a CAPTCHA or challenge and never opts out from search().
 * The opt-out page was also observed to require a per-listing profile URL.
 * Submission is intentionally dry-run only.
 */
export class SpokeoAdapter implements BrokerAdapter {
  readonly brokerId = "spokeo";
  readonly brokerName = "Spokeo";
  readonly method = "form" as const;
  readonly searchUrl = "https://spokeo.com/search";
  readonly optOutUrl = "https://spokeo.com/optout";
  readonly requiredFields = ["emails"] as const;
  readonly searchFields = ["firstName", "lastName", "addresses"] as const;

  /**
   * Search is fail-closed because the live public search returned HTTP 403
   * during verification with dummy John Smith / Seattle, WA data. Since no
   * broker-rendered form or result was available, returning candidates would
   * require fabricating fields or a profile URL.
   */
  async search(page: Page, _profile: Partial<PiiProfile>): Promise<SearchCandidate[]> {
    await page.goto(this.searchUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
    return [];
  }

  async optOut(page: Page, profile: Partial<PiiProfile>): Promise<RemovalResult> {
    const timestamp = new Date().toISOString();
    const email = profile.emails?.[0];
    if (!email) return this.fail(timestamp, "Missing required email");

    await page.goto(this.optOutUrl, { waitUntil: "domcontentloaded" });

    const antiBot = page.locator(
      ".cf-turnstile, #cf-turnstile, [class*='cf-chl-widget'], .g-recaptcha, [data-sitekey], .h-captcha",
    );
    if (await antiBot.count()) {
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
