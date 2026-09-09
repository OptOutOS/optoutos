import type { Page } from "playwright";
import type { BrokerAdapter, RemovalResult } from "./types.js";
import type { PiiProfile } from "../pii.js";

/**
 * Radaris opt-out adapter.
 *
 * Verified against the live Radaris privacy instructions at
 * https://radaris.com/page/how-to-remove and the linked flow description at
 * https://radaris.com/control-privacy on 2026-09-09. The instructions say to
 * open Remove My Info / control-privacy, identify a personal Radaris page by
 * selecting a search result or entering that page URL, click through a
 * "Start Removing" step, enter an email address, and submit. Radaris then
 * sends a verification link and confirmation code by email; the requester
 * must click the email link to complete removal. The instructions say one
 * record is removable through the online flow and that multiple records must
 * be handled through customer service.
 *
 * This is not a simple unattended form submission: the flow requires the
 * user's specific profile URL (or an interactive search-and-select step),
 * identity confirmation, and an out-of-band email confirmation. The live
 * page also states Radaris may request additional name, email, and phone
 * information when site authentication cannot establish identity. No API was
 * documented. Per the adapter anti-bot/manual-verification policy, this
 * adapter does not guess selectors, submit a removal request, or attempt to
 * automate the email confirmation. It fails closed with
 * "requires_manual_verification" and gives the user the verified next steps.
 *
 * No stable form selectors are claimed here: the rendered flow was verified
 * by its visible step text and linked URLs, not by selectors suitable for
 * automated submission.
 */
export class RadarisAdapter implements BrokerAdapter {
  readonly brokerId = "radaris";
  readonly brokerName = "Radaris";
  readonly method = "form" as const;
  readonly searchUrl = "https://radaris.com/";
  readonly optOutUrl = "https://radaris.com/control-privacy";
  readonly requiredFields = ["firstName", "lastName", "addresses", "emails", "phones"] as const;

  async optOut(page: Page, profile: Partial<PiiProfile>): Promise<RemovalResult> {
    const timestamp = new Date().toISOString();

    if (!profile.firstName || !profile.lastName) {
      return this.fail(timestamp, "Missing required name fields");
    }

    const email = profile.emails?.[0];
    if (!email) {
      return this.fail(timestamp, "Missing email required for Radaris verification");
    }

    // Navigate only so callers can continue the verified manual flow in a real
    // browser. Do not fill or submit: the profile URL/search selection and the
    // email confirmation are intentionally user-controlled steps.
    await page.goto(this.optOutUrl, { waitUntil: "domcontentloaded" });

    return {
      broker: this.brokerId,
      status: "requires_manual_verification",
      timestamp,
      evidence: {
        dryRun: true,
        nextStep: "Identify one personal Radaris profile, choose Start Removing, enter the user's email, submit, then click Radaris's verification link and confirmation code from email",
        optOutUrl: this.optOutUrl,
        verification: "Radaris requires out-of-band email confirmation; additional identity information may be requested",
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
