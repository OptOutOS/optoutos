import type { Page } from "playwright";
import type { PiiProfile } from "../pii.js";
import type { BrokerAdapter, RemovalResult } from "./types.js";

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
 * Submission is intentionally dry-run only: after filling the observed
 * subject fields, it returns requires_manual_verification without clicking the
 * real request button or sending an email.
 */
export class UsPhonebookAdapter implements BrokerAdapter {
  readonly brokerId = "usphonebook";
  readonly brokerName = "US Phone Book";
  readonly method = "form" as const;
  readonly searchUrl = "https://usphonebook.com/opt-out";
  readonly optOutUrl = "https://usphonebook.com/opt-out";
  readonly requiredFields = ["firstName", "lastName", "emails"] as const;

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
